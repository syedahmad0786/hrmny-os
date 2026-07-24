import { describe, expect, it, vi } from "vitest";
import type { AsanaAdapter } from "@hrmny/integrations";
import { scanAsanaWorkspace } from "./asana-migration";

describe("Asana migration scan", () => {
  it("deduplicates multi-homed tasks and follows nested subtasks", async () => {
    const shared = { gid: "t1", name: "Shared", num_subtasks: 1 };
    const adapter: AsanaAdapter = {
      me: vi.fn(),
      listWorkspaces: vi.fn(),
      listUsers: vi.fn().mockResolvedValue([{ gid: "u1", name: "Ayham" }]),
      listProjects: vi.fn().mockResolvedValue([
        { gid: "p1", name: "One" },
        { gid: "p2", name: "Two" },
      ]),
      listSections: vi.fn().mockResolvedValue([{ gid: "s1", name: "Doing" }]),
      listProjectTasks: vi.fn().mockResolvedValue([shared]),
      listSubtasks: vi
        .fn()
        .mockResolvedValueOnce([{ gid: "t2", name: "Child", num_subtasks: 1 }])
        .mockResolvedValueOnce([{ gid: "t3", name: "Grandchild" }]),
      listStories: vi
        .fn()
        .mockResolvedValue([
          { gid: "story1", resource_subtype: "comment_added" },
        ]),
      listAttachments: vi
        .fn()
        .mockResolvedValue([{ gid: "file1", name: "brief.pdf" }]),
    };

    const result = await scanAsanaWorkspace(adapter, "w1", "full");

    expect(result.counts).toMatchObject({
      users: 1,
      projects: 2,
      sections: 2,
      topLevelTasks: 1,
      subtasks: 2,
      tasks: 3,
      projectTaskLinks: 2,
      multiHomedTasks: 1,
      stories: 3,
      comments: 3,
      attachments: 3,
    });
    expect(adapter.listSubtasks).toHaveBeenCalledTimes(2);
  });
});
