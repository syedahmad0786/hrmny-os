import { beforeEach, describe, expect, it } from "vitest";
import { createMockRunAgent } from "./agent-run";
import { runCompetitorScan } from "./competitor-scan";
import { listCompetitorFindings, resetLeadgenStore } from "./store";

describe("runCompetitorScan", () => {
  beforeEach(() => resetLeadgenStore());

  it("produces one CompetitorFinding per source and stores them scoped", async () => {
    const rows = await runCompetitorScan({
      competitor: "Rival Co",
      scopeId: "deal-1",
      runAgent: createMockRunAgent(),
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.source)).toEqual(["site", "social", "ads_library"]);
    for (const r of rows) {
      expect(r.competitor).toBe("Rival Co");
      expect(r.scopeId).toBe("deal-1");
      expect(r.capturedAt).toBeTruthy();
      expect(r.detail).toContain("Research basis");
    }

    expect(listCompetitorFindings("deal-1")).toHaveLength(3);
    expect(listCompetitorFindings("other-scope")).toHaveLength(0);
  });

  it("honours a custom source list", async () => {
    const rows = await runCompetitorScan({
      competitor: "Rival Co",
      sources: ["ads_library"],
      runAgent: createMockRunAgent(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("ads_library");
  });
});
