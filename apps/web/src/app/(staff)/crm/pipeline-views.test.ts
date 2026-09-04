import { describe, expect, it } from "vitest";
import {
  isArchived,
  parseSavedPipelineViews,
  retentionLabel,
} from "./pipeline-views";

describe("pipeline operator views", () => {
  it("loads only valid saved views and reports the 90-day retention state", () => {
    expect(
      parseSavedPipelineViews(
        JSON.stringify([
          {
            id: "mine-uae",
            name: "  My UAE pipeline  ",
            filters: {
              search: "hotel",
              source: "relationship_led",
              temperature: "hot",
              market: "UAE",
              owner: "employee-1",
              records: "active",
            },
          },
          { id: "broken", name: "Broken", filters: { records: "unknown" } },
        ]),
      ),
    ).toEqual([
      {
        id: "mine-uae",
        name: "My UAE pipeline",
        filters: {
          search: "hotel",
          source: "relationship_led",
          temperature: "hot",
          market: "UAE",
          owner: "employee-1",
          records: "active",
        },
      },
    ]);
    const now = Date.parse("2026-09-04T00:00:00Z");
    expect(retentionLabel("2026-09-03T00:00:00Z", now)).toBe(
      "Retention day 2 of 90",
    );
    expect(retentionLabel("2026-05-01T00:00:00Z", now)).toBe(
      "Retained in searchable archive",
    );
    expect(isArchived("2026-09-03T00:00:00Z", now)).toBe(false);
    expect(isArchived("2026-05-01T00:00:00Z", now)).toBe(true);
  });
});
