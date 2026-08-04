import { beforeEach, describe, expect, it } from "vitest";
import { getCrmMemory, resetCrmMemory } from "../crm/memory";
import {
  createDeal,
  listActivities,
  listDeals,
  moveDealStage,
  updateDeal,
} from "../crm/repository";
import {
  computeForecast,
  computePipeline,
  computeStageConversion,
  computeWinLoss,
  STAGE_PROBABILITY,
  type StageChangeEvent,
} from "./crm-forecast";

/** Empty the seeded memory store so fixtures are the only data. */
function clearMemory() {
  const m = resetCrmMemory();
  m.companies.clear();
  m.contacts.clear();
  m.deals.clear();
  m.activities.clear();
  m.notes.clear();
  m.tasks.clear();
}

async function seedDeal(input: {
  quoteValue: string;
  stage?: string;
  closeOutcome?: "won" | "lost" | "postponed_on_hold";
  lostReason?: string;
}) {
  const d = await createDeal({ companyName: "Fixture Co" });
  if (input.stage && input.stage !== "discover") {
    const res = await moveDealStage({ dealId: d.dealId, to: input.stage });
    expect(res.ok).toBe(true);
  }
  await updateDeal(d.dealId, {
    quoteValue: input.quoteValue,
    closeOutcome: input.closeOutcome ?? null,
    lostReason: input.lostReason ?? null,
  });
  return d;
}

async function stageChangesFromTrail(): Promise<StageChangeEvent[]> {
  const rows = await listActivities({ limit: 1000 });
  return rows
    .filter((a) => a.type === "stage_change")
    .map((a) => a.metadata as StageChangeEvent);
}

beforeEach(clearMemory);

describe("computePipeline (memory repository)", () => {
  it("groups open deals per stage with count/total/weighted values", async () => {
    await seedDeal({ quoteValue: "1000.00" }); // discover, p=0.05
    await seedDeal({ quoteValue: "2000.00", stage: "propose" }); // p=0.55
    await seedDeal({ quoteValue: "3000.00", stage: "propose" });
    await seedDeal({ quoteValue: "9999.00", closeOutcome: "won" }); // excluded

    const res = computePipeline(await listDeals());

    const byStage = Object.fromEntries(res.stages.map((s) => [s.stage, s]));
    expect(byStage.discover).toMatchObject({
      count: 1,
      totalValue: 1000,
      weightedValue: 50,
      probability: STAGE_PROBABILITY.discover,
    });
    expect(byStage.propose).toMatchObject({
      count: 2,
      totalValue: 5000,
      weightedValue: 2750,
    });
    expect(byStage.qualify!.count).toBe(0);
    expect(res.totals).toEqual({
      count: 3,
      totalValue: 6000,
      weightedValue: 2800,
    });
  });
});

describe("computeForecast (memory repository)", () => {
  it("combines weighted pipeline with won run-rate projection", async () => {
    await seedDeal({ quoteValue: "1000.00", stage: "close" }); // open, p=0.9
    await seedDeal({ quoteValue: "9000.00", closeOutcome: "won" }); // in window

    const res = computeForecast(await listDeals(), { horizonDays: 90 });

    expect(res.horizonDays).toBe(90);
    expect(res.weightedPipelineValue).toBe(900);
    expect(res.wonInWindow).toEqual({ count: 1, value: 9000 });
    expect(res.runRatePerDay).toBe(100);
    expect(res.runRateProjection).toBe(9000);
  });

  it("excludes wins older than the window", async () => {
    const d = await seedDeal({ quoteValue: "9000.00", closeOutcome: "won" });
    const mem = getCrmMemory();
    const row = mem.deals.get(d.dealId)!;
    mem.deals.set(d.dealId, {
      ...row,
      updatedAt: new Date(Date.now() - 200 * 864e5).toISOString(),
    });

    const res = computeForecast(await listDeals(), { horizonDays: 90 });
    expect(res.wonInWindow.count).toBe(0);
    expect(res.runRateProjection).toBe(0);
  });
});

describe("computeWinLoss (memory repository)", () => {
  it("counts won/lost, computes win rate, and ranks lost reasons", async () => {
    await seedDeal({ quoteValue: "1.00", closeOutcome: "won" });
    await seedDeal({ quoteValue: "1.00", closeOutcome: "won" });
    await seedDeal({ quoteValue: "1.00", closeOutcome: "lost", lostReason: "budget" });
    await seedDeal({ quoteValue: "1.00", closeOutcome: "lost", lostReason: "budget" });
    await seedDeal({ quoteValue: "1.00", closeOutcome: "lost", lostReason: "timing" });
    await seedDeal({ quoteValue: "1.00", closeOutcome: "postponed_on_hold" }); // excluded
    await seedDeal({ quoteValue: "1.00" }); // open, excluded

    const res = computeWinLoss(await listDeals(), { sinceDays: 90 });

    expect(res.won).toBe(2);
    expect(res.lost).toBe(3);
    expect(res.winRate).toBe(0.4);
    expect(res.topLostReasons).toEqual([
      { reason: "budget", count: 2 },
      { reason: "timing", count: 1 },
    ]);
  });

  it("returns zeros with no closed deals", async () => {
    await seedDeal({ quoteValue: "1.00" });
    const res = computeWinLoss(await listDeals());
    expect(res.won).toBe(0);
    expect(res.lost).toBe(0);
    expect(res.winRate).toBe(0);
    expect(res.topLostReasons).toEqual([]);
  });
});

describe("computeStageConversion (memory repository)", () => {
  it("uses the moveDealStage audit trail when stage changes exist", async () => {
    // Two deals advance discover→qualify; one regresses qualify→discover.
    const a = await seedDeal({ quoteValue: "1.00", stage: "qualify" });
    await seedDeal({ quoteValue: "1.00", stage: "qualify" });
    await moveDealStage({ dealId: a.dealId, to: "discover" });

    const res = computeStageConversion(
      await listDeals(),
      await stageChangesFromTrail(),
    );

    expect(res.method).toBe("audit_trail");
    const byStage = Object.fromEntries(res.stages.map((s) => [s.stage, s]));
    expect(byStage.discover).toMatchObject({ entered: 2, advanced: 2, rate: 1 });
    expect(byStage.qualify).toMatchObject({ entered: 1, advanced: 0, rate: 0 });
    expect(byStage.engage).toMatchObject({ entered: 0, rate: null });
  });

  it("falls back to stage-distribution survival with no audit trail", async () => {
    // No moveDealStage calls → no stage_change activities.
    await seedDeal({ quoteValue: "1.00" }); // discover, open
    await seedDeal({ quoteValue: "1.00" }); // discover, open
    await seedDeal({ quoteValue: "1.00", closeOutcome: "won" }); // beyond all
    await seedDeal({ quoteValue: "1.00", closeOutcome: "lost" }); // rests at discover

    const res = computeStageConversion(
      await listDeals(),
      await stageChangesFromTrail(),
    );

    expect(res.method).toBe("stage_distribution");
    const byStage = Object.fromEntries(res.stages.map((s) => [s.stage, s]));
    // 4 at-or-beyond discover; only the won deal counts beyond → 0.25.
    expect(byStage.discover).toMatchObject({ entered: 4, advanced: 1, rate: 0.25 });
    expect(byStage.qualify).toMatchObject({ entered: 1, advanced: 1, rate: 1 });
  });
});
