import { describe, expect, it, vi } from "vitest";
import type { AsanaAdapter } from "@hrmny/integrations";
import { scanAsanaWorkspace } from "./asana-migration";

describe("Asana migration scan", () => {
  it("deduplicates multi-homed tasks and follows nested subtasks", async () => {
    const shared = {
      gid: "t1",
      name: "Shared",
      num_subtasks: 1,
      custom_type: { gid: "ct1", name: "Request" },
      custom_type_status_option: { gid: "cts1", name: "Open" },
    };
    const sharedInMyTasks = {
      ...shared,
      assignee_section: { gid: "ms1", name: "Today" },
    };
    const personal = {
      gid: "t4",
      name: "Private",
      assignee: { gid: "u1", name: "Ayham", email: "ayham@hrmny.co" },
      assignee_section: { gid: "ms1", name: "Today" },
    };
    const adapter: AsanaAdapter = {
      me: vi.fn(),
      listWorkspaces: vi.fn(),
      listUsers: vi
        .fn()
        .mockResolvedValue([
          { gid: "u1", name: "Ayham", email: "ayham@hrmny.co" },
        ]),
      listTeams: vi.fn().mockResolvedValue([{ gid: "team1", name: "Ops" }]),
      listTeamMemberships: vi.fn().mockResolvedValue([
        {
          gid: "tm1",
          user: { gid: "u1", name: "Ayham" },
          team: { gid: "team1" },
          is_admin: true,
        },
      ]),
      listProjects: vi.fn().mockResolvedValue([
        { gid: "p1", name: "One" },
        { gid: "p2", name: "Two" },
      ]),
      listProjectMemberships: vi.fn().mockResolvedValue([
        {
          gid: "pm1",
          parent: { gid: "p1" },
          member: { gid: "u1", name: "Ayham", resource_type: "user" },
          access_level: "editor",
        },
      ]),
      listSections: vi.fn((gid) =>
        Promise.resolve(
          gid === "utl1"
            ? [{ gid: "ms1", name: "Today" }]
            : [{ gid: "s1", name: "Doing" }],
        ),
      ),
      listProjectTasks: vi.fn().mockResolvedValue([shared]),
      listCustomTypes: vi.fn().mockResolvedValue([
        {
          gid: "ct1",
          name: "Request",
          status_options: [
            {
              gid: "cts1",
              name: "Open",
              completion_state: "incomplete",
            },
            {
              gid: "cts2",
              name: "Resolved",
              completion_state: "complete",
            },
          ],
        },
      ]),
      getCustomType: vi.fn(),
      getUserTaskList: vi.fn().mockResolvedValue({
        gid: "utl1",
        name: "My Tasks",
        owner: { gid: "u1", name: "Ayham", email: "ayham@hrmny.co" },
        workspace: { gid: "w1", name: "Main" },
      }),
      listUserTaskListTasks: vi
        .fn()
        .mockResolvedValue([sharedInMyTasks, personal]),
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
      listGoals: vi.fn().mockResolvedValue([{ gid: "g1", name: "Grow" }]),
      listGoalRelationships: vi.fn().mockResolvedValue([
        {
          gid: "gr1",
          resource_subtype: "supporting_work",
          supporting_resource: { gid: "p1", resource_type: "project" },
        },
      ]),
      listPortfolios: vi
        .fn()
        .mockResolvedValue([{ gid: "pf1", name: "Roadmap" }]),
      listPortfolioItems: vi
        .fn()
        .mockResolvedValue([{ gid: "p1", name: "One" }]),
      listProjectTemplates: vi
        .fn()
        .mockResolvedValue([{ gid: "pt1", name: "Launch" }]),
      listTaskTemplates: vi
        .fn()
        .mockResolvedValue([{ gid: "tt1", name: "Review" }]),
      listStatusUpdates: vi
        .fn()
        .mockResolvedValue([
          { gid: "status1", title: "Weekly", status_type: "on_track" },
        ]),
      listTimeTrackingEntries: vi.fn().mockResolvedValue([
        {
          gid: "time1",
          duration_minutes: 30,
          entered_on: "2026-07-24",
          created_by: { gid: "u1", name: "Ayham" },
        },
      ]),
      workspaceEvents: vi.fn(),
      createWebhook: vi.fn(),
      deleteWebhook: vi.fn(),
    };

    const result = await scanAsanaWorkspace(adapter, "w1", "full");

    expect(result.counts).toMatchObject({
      users: 1,
      teams: 1,
      teamMemberships: 1,
      projects: 2,
      projectMemberships: 2,
      sections: 2,
      myTaskSections: 1,
      myTasks: 2,
      myTasksOnly: 1,
      topLevelTasks: 2,
      subtasks: 2,
      tasks: 4,
      projectTaskLinks: 2,
      multiHomedTasks: 1,
      customTaskTypes: 1,
      customTaskStatuses: 2,
      projectCustomTaskTypes: 2,
      stories: 4,
      comments: 4,
      attachments: 4,
      timeTrackingEntries: 4,
      goals: 1,
      goalRelationships: 1,
      portfolios: 1,
      portfolioItems: 1,
      projectTemplates: 1,
      taskTemplates: 2,
      statusUpdates: 4,
    });
    expect(adapter.listSubtasks).toHaveBeenCalledTimes(2);
    expect(adapter.listCustomTypes).toHaveBeenCalledTimes(2);
    expect(adapter.getCustomType).not.toHaveBeenCalled();
    expect(result.myTasks).toEqual([
      {
        taskGid: "t1",
        sectionGid: "ms1",
        position: 0,
        projectless: false,
      },
      {
        taskGid: "t4",
        sectionGid: "ms1",
        position: 1,
        projectless: true,
      },
    ]);
    expect(result.tasks.filter((task) => task.gid === "t1")).toHaveLength(1);
    expect(result.tasks.find((task) => task.gid === "t1")).toMatchObject({
      assignee_section: { gid: "ms1" },
    });
  });
});
