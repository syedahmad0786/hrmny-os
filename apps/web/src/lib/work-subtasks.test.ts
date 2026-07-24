import { describe, expect, it } from "vitest";
import { visibleSubtasks } from "./work-subtasks";

describe("subtask view controls", () => {
  it("hides completed work and sorts null dates last", () => {
    const items = [
      {
        title: "No date",
        parentItemId: "parent",
        position: 0,
        dueAt: null,
        assigneeName: null,
        completedAt: null,
      },
      {
        title: "Done",
        parentItemId: "parent",
        position: 1,
        dueAt: "2026-07-20T00:00:00.000Z",
        assigneeName: "A",
        completedAt: "2026-07-19T00:00:00.000Z",
      },
      {
        title: "Soon",
        parentItemId: "parent",
        position: 2,
        dueAt: "2026-07-25T00:00:00.000Z",
        assigneeName: "B",
        completedAt: null,
      },
    ];
    expect(
      visibleSubtasks(items, "parent", {
        showCompleted: false,
        sort: "due_date",
      }).map((item) => item.title),
    ).toEqual(["Soon", "No date"]);
  });
});
