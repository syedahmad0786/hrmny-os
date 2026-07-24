import { describe, expect, it } from "vitest";
import { asanaEventEffects } from "./asana-sync";

describe("Asana sync event effects", () => {
  it("classifies destructive and membership events without treating removal as deletion", () => {
    expect(
      asanaEventEffects([
        {
          resource: { gid: "t1", resource_type: "task" },
          parent: { gid: "p1", resource_type: "project" },
          action: "removed",
        },
        {
          resource: { gid: "t2", resource_type: "task" },
          action: "deleted",
        },
        {
          resource: { gid: "a1", resource_type: "attachment" },
          action: "deleted",
        },
      ]),
    ).toMatchObject({
      archivedTaskGids: ["t2"],
      deletedAttachmentGids: ["a1"],
      removedProjectTasks: [{ projectGid: "p1", taskGid: "t1" }],
    });
  });
});
