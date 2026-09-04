import { describe, expect, it } from "vitest";
import { orderOutreachWorkItems } from "./order";

const items = [
  { id: "newest", createdAt: "2026-09-04T12:00:00.000Z" },
  { id: "oldest", createdAt: "2026-09-02T12:00:00.000Z" },
  { id: "middle", createdAt: "2026-09-03T12:00:00.000Z" },
];

describe("orderOutreachWorkItems", () => {
  it("orders work oldest first", () => {
    expect(orderOutreachWorkItems(items).map((item) => item.id)).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("keeps a directly linked item in focus", () => {
    expect(orderOutreachWorkItems(items, "newest").map((item) => item.id)).toEqual([
      "newest",
      "oldest",
      "middle",
    ]);
  });
});
