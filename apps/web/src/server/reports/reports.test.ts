import { beforeEach, describe, expect, it } from "vitest";
import { createResendMock } from "@hrmny/integrations";
import type { WeeklyReport } from "../analytics/report";
import { isDue, renderMarkdown } from "./types";
import {
  campaignSummary,
  capacityForecast,
  pipelineSummary,
  weeklyAgency,
  type CampaignFacts,
  type CapacityFacts,
  type PipelineFacts,
} from "./registry";
import { createSchedule, dueSchedules, listRuns, resetReportStore } from "./store";
import {
  runDueReports,
  runScheduleNow,
} from "../inngest/report-scheduler";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("isDue — due-schedule math", () => {
  it("never due when disabled", () => {
    expect(isDue({ enabled: false, cadence: "daily", lastRunAt: null }, NOW)).toBe(false);
  });
  it("due when never run", () => {
    expect(isDue({ enabled: true, cadence: "weekly", lastRunAt: null }, NOW)).toBe(true);
  });
  it("weekly due once 7d elapsed", () => {
    expect(isDue({ enabled: true, cadence: "weekly", lastRunAt: daysAgo(8) }, NOW)).toBe(true);
  });
  it("weekly not due before 7d", () => {
    expect(isDue({ enabled: true, cadence: "weekly", lastRunAt: daysAgo(2) }, NOW)).toBe(false);
  });
  it("daily due after a day", () => {
    expect(isDue({ enabled: true, cadence: "daily", lastRunAt: daysAgo(1.1) }, NOW)).toBe(true);
  });
  it("unknown cadence never auto-fires", () => {
    expect(isDue({ enabled: true, cadence: "hourly", lastRunAt: null }, NOW)).toBe(false);
  });
});

describe("report assemblers on planted facts", () => {
  it("pipeline-summary", () => {
    const facts: PipelineFacts = {
      generatedAt: NOW.toISOString(),
      openCount: 5,
      totalOpenValueAed: "100000.00",
      weightedValueAed: "45000.00",
      winRatePct: 45,
      dealsClosed: 20,
      dealsWon: 9,
    };
    const artifact = pipelineSummary.assemble(facts);
    expect(artifact.title).toBe("Pipeline Summary");
    const md = renderMarkdown(artifact);
    expect(md).toContain("Open deals: 5");
    expect(md).toContain("Win-weighted value: AED 45000.00");
    expect(md).toContain("Win rate: 45%");
  });

  it("capacity-forecast", () => {
    const facts: CapacityFacts = {
      generatedAt: NOW.toISOString(),
      capacity: {
        weeks: 4,
        utilizationPct: 0.75,
        overbookedRoles: ["Alice", "Bob"],
        note: "120h scheduled",
      },
    };
    const md = renderMarkdown(capacityForecast.assemble(facts));
    expect(md).toContain("Assigned-team utilization: 75%");
    expect(md).toContain("Alice, Bob");
  });

  it("campaign-summary", () => {
    const facts: CampaignFacts = {
      generatedAt: NOW.toISOString(),
      total: 3,
      byStatus: { draft: 2, approved: 1 },
      upcoming: [
        { title: "Launch reel", channel: "linkedin", scheduledFor: "2026-08-01" },
      ],
    };
    const md = renderMarkdown(campaignSummary.assemble(facts));
    expect(md).toContain("Total campaigns: 3");
    expect(md).toContain("draft: 2");
    expect(md).toContain("2026-08-01 — Launch reel (linkedin)");
  });

  it("weekly-agency (reuses analytics report)", () => {
    const report: WeeklyReport = {
      weekOf: "2026-07-27",
      pipeline: { open: 4, weightedValueAed: "12000.00" },
      capacityUtilizationPct: 0.6,
      churnRiskCount: 2,
      narrative: "Steady week across the portfolio.",
    };
    const artifact = weeklyAgency.assemble(report);
    expect(artifact.title).toContain("2026-07-27");
    const md = renderMarkdown(artifact);
    expect(md).toContain("Steady week across the portfolio.");
    expect(md).toContain("Clients at churn risk: 2");
  });
});

describe("runDueReports — mock-first runner", () => {
  beforeEach(() => resetReportStore());

  it("assembles a due schedule, records a sent run, emails via mock Resend", async () => {
    const emailer = createResendMock();
    const schedule = await createSchedule({
      reportKey: "capacity-forecast",
      cadence: "daily",
      recipients: ["ops@hrmny.os"],
    });

    const summary = await runDueReports(NOW, { emailer });

    expect(summary.due).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(0);
    expect(emailer.recorded()).toHaveLength(1);
    expect(emailer.recorded()[0]!.to).toEqual(["ops@hrmny.os"]);

    const runs = await listRuns(schedule.reportScheduleId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("sent");
    expect(typeof runs[0]!.artifact.markdown).toBe("string");
  });

  it("is idempotent — a re-tick within the cadence window sends nothing", async () => {
    const emailer = createResendMock();
    await createSchedule({
      reportKey: "capacity-forecast",
      cadence: "daily",
      recipients: ["ops@hrmny.os"],
    });

    await runDueReports(NOW, { emailer });
    const second = await runDueReports(NOW, { emailer });

    expect(second.due).toBe(0);
    expect(second.sent).toBe(0);
    expect(emailer.recorded()).toHaveLength(1);
  });

  it("records a failed run for an unknown report_key without throwing", async () => {
    const emailer = createResendMock();
    await createSchedule({
      reportKey: "does-not-exist",
      cadence: "daily",
      recipients: ["ops@hrmny.os"],
    });

    const summary = await runDueReports(NOW, { emailer });

    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(emailer.recorded()).toHaveLength(0);
  });

  it("run-now sends regardless of cadence then blocks the scheduled tick", async () => {
    const emailer = createResendMock();
    const schedule = await createSchedule({
      reportKey: "capacity-forecast",
      cadence: "weekly",
      recipients: ["ops@hrmny.os"],
    });

    const run = await runScheduleNow(schedule.reportScheduleId, { emailer });
    expect(run?.status).toBe("sent");
    expect(emailer.recorded()).toHaveLength(1);

    // last_run_at advanced → the weekly schedule is no longer due this tick.
    expect(await dueSchedules(new Date())).toHaveLength(0);
  });
});
