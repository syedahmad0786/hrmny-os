import { describe, expect, it } from "vitest";
import { keywordSearchFromRows } from "@hrmny/ai";

describe("memory retrieval helpers", () => {
  it("scores keyword matches for retrieve-before-act fallback", () => {
    const rows = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        sourceType: "note" as const,
        sourceId: null,
        content: "JW Marriott prefers Arabic subtitles on social cutdowns",
        metadata: { dealId: "22222222-2222-2222-2222-222222222222" },
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        sourceType: "feedback" as const,
        sourceId: null,
        content: "Lost because pricing was too high for KSA market",
        metadata: { outcome: "lost" },
      },
    ];
    const hits = keywordSearchFromRows(rows, {
      query: "Arabic subtitles Marriott",
      limit: 5,
    });
    expect(hits[0]?.id).toBe(rows[0]!.id);
    expect(hits[0]!.score).toBeGreaterThan(0);
  });
});
