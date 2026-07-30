import { beforeEach, describe, expect, it } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  assertScorableKind,
  compute,
  dealBuafEvidence,
  DEAL_BUAF_V1,
  validateWeights,
  type Evidence,
} from "./engine";
import {
  getActiveDefinition,
  getDefinition,
  getSnapshot,
  insertSnapshot,
  listDefinitions,
  listOverrides,
  listSnapshots,
  overrideSnapshot,
  resetScorecardMemory,
  saveDefinition,
  scoreDealFromBuaf,
  setDefinitionActive,
} from "./store";

const EMAAR_DEAL = "e0000000-0000-4000-8000-000000000002"; // BUAF all true
const ALBAIK_DEAL = "e0000000-0000-4000-8000-000000000003"; // budget/access/fit true, urgency false
const TEJARI_DEAL = "e0000000-0000-4000-8000-000000000004"; // all false

const ev = (factor: string, value: number): Evidence => ({ factor, value });

beforeEach(() => {
  resetCrmMemory();
  resetScorecardMemory();
});

describe("compute — planted fixtures", () => {
  it("all four BUAF factors satisfied → 100", () => {
    const snap = compute(DEAL_BUAF_V1, "deal-x", [
      ev("budget", 1),
      ev("urgency", 1),
      ev("access", 1),
      ev("fit", 1),
    ]);
    expect(snap.score).toBe(100);
    expect(snap.breakdown.factors).toHaveLength(4);
    expect(snap.breakdown.factors.find((f) => f.factor === "budget")).toMatchObject(
      { weight: 0.25, value: 1, contribution: 25 },
    );
  });

  it("one of four missing → 75, missing factor scores 0 at confidence 0", () => {
    const snap = compute(DEAL_BUAF_V1, "deal-x", [
      ev("budget", 1),
      ev("access", 1),
      ev("fit", 1),
    ]);
    expect(snap.score).toBe(75);
    const urgency = snap.breakdown.factors.find((f) => f.factor === "urgency")!;
    expect(urgency.value).toBe(0);
    expect(urgency.confidence).toBe(0);
    expect(urgency.contribution).toBe(0);
  });

  it("no evidence → 0", () => {
    const snap = compute(DEAL_BUAF_V1, "deal-x", []);
    expect(snap.score).toBe(0);
    expect(snap.breakdown.confidence).toBe(0);
  });

  it("carries per-factor freshness + confidence into the breakdown", () => {
    const snap = compute(DEAL_BUAF_V1, "deal-x", [
      { factor: "budget", value: 1, ref: "deal:buafBudget", freshness: 0.5, confidence: 1 },
      { factor: "urgency", value: 1, freshness: 1, confidence: 1 },
      { factor: "access", value: 1, freshness: 1, confidence: 1 },
      { factor: "fit", value: 1, freshness: 1, confidence: 1 },
    ]);
    const budget = snap.breakdown.factors.find((f) => f.factor === "budget")!;
    expect(budget.evidence).toEqual(["deal:buafBudget"]);
    expect(budget.freshness).toBe(0.5);
    // weighted overall freshness = 0.25*0.5 + 0.75*1 = 0.875
    expect(snap.breakdown.freshness).toBeCloseTo(0.875, 3);
  });
});

describe("scoreDealFromBuaf — planted deal fixtures", () => {
  it("Emaar (all BUAF true) → 100", async () => {
    const snap = await scoreDealFromBuaf({ dealId: EMAAR_DEAL });
    expect(snap.score).toBe(100);
    expect(snap.definitionKey).toBe("deal-buaf-v1");
    expect(snap.entityKind).toBe("deal");
  });

  it("Al Baik (urgency false) → 75", async () => {
    const snap = await scoreDealFromBuaf({ dealId: ALBAIK_DEAL });
    expect(snap.score).toBe(75);
  });

  it("Tejari (all false) → 0", async () => {
    const snap = await scoreDealFromBuaf({ dealId: TEJARI_DEAL });
    expect(snap.score).toBe(0);
  });

  it("persists a snapshot listable by entity", async () => {
    const snap = await scoreDealFromBuaf({ dealId: EMAAR_DEAL });
    const rows = await listSnapshots({ entityKind: "deal", entityId: EMAAR_DEAL });
    expect(rows.map((r) => r.scorecardSnapshotId)).toContain(snap.scorecardSnapshotId);
  });

  it("null BUAF fields → freshness/confidence from deal, value 0", () => {
    const evidence = dealBuafEvidence(
      {
        // minimal deal shape; only fields the mapper reads
        dealId: "d1",
        buafBudget: null,
        buafUrgency: false,
        buafAccess: true,
        buafFit: null,
        updatedAt: new Date().toISOString(),
      } as never,
      Date.now(),
    );
    const budget = evidence.find((e) => e.factor === "budget")!;
    expect(budget.value).toBe(0);
    expect(budget.confidence).toBe(0); // null = unknown, not confident no
    const access = evidence.find((e) => e.factor === "access")!;
    expect(access.value).toBe(1);
    expect(access.confidence).toBe(1);
  });
});

describe("definition versioning", () => {
  it("saving an existing key bumps version and deactivates prior versions", async () => {
    const weights = [
      { key: "a", weight: 0.5 },
      { key: "b", weight: 0.5 },
    ];
    const v1 = await saveDefinition({ key: "lead-fit", entityKind: "lead", weights });
    expect(v1.version).toBe(1);
    expect(v1.active).toBe(true);

    const v2 = await saveDefinition({
      key: "lead-fit",
      entityKind: "lead",
      weights: [
        { key: "a", weight: 0.7 },
        { key: "b", weight: 0.3 },
      ],
    });
    expect(v2.version).toBe(2);

    const active = await getActiveDefinition("lead-fit");
    expect(active?.version).toBe(2);

    const stale = await getDefinition(v1.scorecardDefinitionId);
    expect(stale?.active).toBe(false);
  });

  it("rejects weights that do not sum to 1", async () => {
    await expect(
      saveDefinition({
        key: "bad",
        entityKind: "vendor",
        weights: [{ key: "a", weight: 0.3 }],
      }),
    ).rejects.toThrow(/sum to 1/);
  });
});

describe("no employee/person performance scoring (hard rule)", () => {
  it("assertScorableKind rejects employee and person kinds", () => {
    expect(() => assertScorableKind("employee")).toThrow(/must not rate people/i);
    expect(() => assertScorableKind("person")).toThrow(/must not rate people/i);
    expect(() => assertScorableKind("performance")).toThrow(/must not rate people/i);
  });

  it("accepts the v1 scorable kinds", () => {
    for (const kind of ["lead", "deal", "client", "campaign", "vendor", "system_health"]) {
      expect(() => assertScorableKind(kind)).not.toThrow();
    }
  });

  it("saveDefinition rejects an employee entity kind", async () => {
    await expect(
      saveDefinition({
        key: "eng-perf",
        entityKind: "employee",
        weights: [{ key: "velocity", weight: 1 }],
      }),
    ).rejects.toThrow(/must not rate people/i);
  });

  it("compute refuses a definition carrying a forbidden kind", () => {
    const rogue = { ...DEAL_BUAF_V1, entityKind: "employee" as never };
    expect(() => compute(rogue, "x", [])).toThrow(/must not rate people/i);
  });
});

describe("override requires justification", () => {
  async function seedSnapshot() {
    return insertSnapshot({
      definitionId: DEAL_BUAF_V1.scorecardDefinitionId,
      snapshot: compute(DEAL_BUAF_V1, "deal-x", [ev("budget", 1)]),
    });
  }

  it("rejects an empty or whitespace reason", async () => {
    const snap = await seedSnapshot();
    await expect(
      overrideSnapshot({ snapshotId: snap.scorecardSnapshotId, actor: "emp-1", reason: "", newScore: 90 }),
    ).rejects.toThrow(/justification/i);
    await expect(
      overrideSnapshot({ snapshotId: snap.scorecardSnapshotId, actor: "emp-1", reason: "   ", newScore: 90 }),
    ).rejects.toThrow(/justification/i);
  });

  it("records a justified override", async () => {
    const snap = await seedSnapshot();
    const override = await overrideSnapshot({
      snapshotId: snap.scorecardSnapshotId,
      actor: "emp-1",
      reason: "Signed LOI not yet in CRM",
      newScore: 90,
    });
    expect(override.newScore).toBe(90);
    const rows = await listOverrides(snap.scorecardSnapshotId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("Signed LOI not yet in CRM");
  });
});

describe("memory-mode CRUD", () => {
  it("seeds deal-buaf-v1 and round-trips definitions", async () => {
    const seeded = await getActiveDefinition("deal-buaf-v1");
    expect(seeded?.key).toBe("deal-buaf-v1");

    const all = await listDefinitions();
    expect(all.some((d) => d.key === "deal-buaf-v1")).toBe(true);

    const def = await saveDefinition({
      key: "client-health",
      entityKind: "client",
      weights: [{ key: "engagement", weight: 1 }],
    });
    expect(await getDefinition(def.scorecardDefinitionId)).toMatchObject({
      key: "client-health",
      active: true,
    });

    const deactivated = await setDefinitionActive(def.scorecardDefinitionId, false);
    expect(deactivated?.active).toBe(false);
  });

  it("round-trips snapshots by id and by entity", async () => {
    const snap = await insertSnapshot({
      definitionId: DEAL_BUAF_V1.scorecardDefinitionId,
      snapshot: compute(DEAL_BUAF_V1, "client-42", [ev("budget", 1), ev("fit", 1)]),
    });
    expect((await getSnapshot(snap.scorecardSnapshotId))?.score).toBe(50);
    const byEntity = await listSnapshots({ entityKind: "deal", entityId: "client-42" });
    expect(byEntity).toHaveLength(1);
  });
});
