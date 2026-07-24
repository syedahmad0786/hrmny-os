import type {
  AsanaAdapter,
  AsanaAttachment,
  AsanaCustomType,
  AsanaGoal,
  AsanaGoalRelationship,
  AsanaMembership,
  AsanaPortfolio,
  AsanaProject,
  AsanaProjectTemplate,
  AsanaSection,
  AsanaStatusUpdate,
  AsanaStory,
  AsanaTask,
  AsanaTaskTemplate,
  AsanaTeam,
  AsanaTeamMembership,
  AsanaTimeTrackingEntry,
  AsanaUser,
  AsanaUserTaskList,
} from "@hrmny/integrations";

export type AsanaScanDepth = "structure" | "full";

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  visit: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await visit(values[index]!);
      }
    }),
  );
  return results;
}

export type AsanaWorkspaceScan = {
  depth: AsanaScanDepth;
  users: AsanaUser[];
  teams: AsanaTeam[];
  teamMemberships: Array<{
    teamGid: string;
    membership: AsanaTeamMembership;
  }>;
  projects: AsanaProject[];
  projectMemberships: Array<{
    projectGid: string;
    membership: AsanaMembership;
  }>;
  sections: Array<AsanaSection & { projectGid: string }>;
  myTaskList: AsanaUserTaskList;
  myTaskSections: AsanaSection[];
  myTasks: Array<{
    taskGid: string;
    sectionGid: string | null;
    position: number;
    projectless: boolean;
  }>;
  tasks: AsanaTask[];
  projectTasks: Array<{
    projectGid: string;
    taskGid: string;
    sectionGid: string | null;
  }>;
  customTaskTypes: AsanaCustomType[];
  customTaskTypeMemberships: Array<{
    customTaskTypeGid: string;
    membership: AsanaMembership;
  }>;
  projectCustomTaskTypes: Array<{
    projectGid: string;
    customTaskTypeGid: string;
  }>;
  stories: Array<{ taskGid: string; story: AsanaStory }> | null;
  attachments: Array<{ taskGid: string; attachment: AsanaAttachment }> | null;
  timeTrackingEntries: Array<{
    taskGid: string;
    entry: AsanaTimeTrackingEntry;
  }> | null;
  goals: AsanaGoal[];
  goalRelationships: Array<{
    goalGid: string;
    relationship: AsanaGoalRelationship;
  }>;
  portfolios: AsanaPortfolio[];
  portfolioItems: Array<{ portfolioGid: string; projectGid: string }>;
  projectTemplates: AsanaProjectTemplate[];
  taskTemplates: AsanaTaskTemplate[];
  statusUpdates: Array<{
    parentType: "project" | "portfolio" | "goal";
    parentGid: string;
    status: AsanaStatusUpdate;
  }> | null;
  counts: {
    users: number;
    teams: number;
    teamMemberships: number;
    projects: number;
    projectMemberships: number;
    sections: number;
    myTaskSections: number;
    myTasks: number;
    myTasksOnly: number;
    topLevelTasks: number;
    subtasks: number;
    tasks: number;
    projectTaskLinks: number;
    multiHomedTasks: number;
    tags: number;
    customFields: number;
    objectCustomFieldValues: number;
    customTaskTypes: number;
    customTaskTypeMemberships: number;
    customTaskStatuses: number;
    projectCustomTaskTypes: number;
    stories: number | null;
    comments: number | null;
    attachments: number | null;
    timeTrackingEntries: number | null;
    goals: number;
    goalRelationships: number;
    portfolios: number;
    portfolioItems: number;
    projectTemplates: number;
    taskTemplates: number;
    statusUpdates: number | null;
  };
};

export async function scanAsanaWorkspace(
  adapter: AsanaAdapter,
  workspaceGid: string,
  depth: AsanaScanDepth = "full",
): Promise<AsanaWorkspaceScan> {
  const [
    users,
    teams,
    projects,
    goals,
    portfolios,
    projectTemplates,
    myTaskList,
  ] = await Promise.all([
    adapter.listUsers(workspaceGid),
    adapter.listTeams(workspaceGid),
    adapter.listProjects(workspaceGid),
    adapter.listGoals(workspaceGid),
    adapter.listPortfolios(workspaceGid),
    adapter.listProjectTemplates(workspaceGid),
    adapter.getUserTaskList("me", workspaceGid),
  ]);
  const [myTaskSections, myTaskValues] = await Promise.all([
    adapter.listSections(myTaskList.gid),
    adapter.listUserTaskListTasks(myTaskList.gid),
  ]);
  const teamRows = await mapLimit(teams, 4, async (team) => ({
    teamGid: team.gid,
    memberships: await adapter.listTeamMemberships(team.gid),
  }));
  const projectRows = await mapLimit(projects, 4, async (project) => {
    const [sections, tasks, memberships, taskTemplates, customTaskTypes] =
      await Promise.all([
        adapter.listSections(project.gid),
        adapter.listProjectTasks(project.gid),
        adapter.listProjectMemberships(project.gid),
        adapter.listTaskTemplates(project.gid),
        adapter.listCustomTypes(project.gid),
      ]);
    return {
      projectGid: project.gid,
      sections,
      tasks,
      memberships,
      taskTemplates,
      customTaskTypes,
    };
  });
  const goalRows = await mapLimit(goals, 4, async (goal) => ({
    goalGid: goal.gid,
    relationships: await adapter.listGoalRelationships(goal.gid),
  }));
  const portfolioRows = await mapLimit(portfolios, 4, async (portfolio) => ({
    portfolioGid: portfolio.gid,
    items: await adapter.listPortfolioItems(portfolio.gid),
  }));

  const tasks = new Map<string, AsanaTask>();
  for (const row of projectRows) {
    for (const task of row.tasks) {
      tasks.set(task.gid, task);
    }
  }
  // The connected user's response is the only one allowed to include
  // assignee_section, so keep it when the task is also in a project.
  for (const task of myTaskValues) tasks.set(task.gid, task);
  const topLevelTaskIds = new Set(tasks.keys());

  const parents = [...tasks.values()].filter(
    (task) => (task.num_subtasks ?? 0) > 0,
  );
  const queuedParents = new Set(parents.map((task) => task.gid));
  const scannedParents = new Set<string>();
  let parentOffset = 0;
  while (parentOffset < parents.length) {
    const batch = parents
      .slice(parentOffset, parentOffset + 5)
      .filter((task) => !scannedParents.has(task.gid));
    parentOffset += Math.min(5, parents.length - parentOffset);
    const children = await mapLimit(batch, 5, async (parent) => {
      scannedParents.add(parent.gid);
      return adapter.listSubtasks(parent.gid);
    });
    for (const child of children.flat()) {
      if (!tasks.has(child.gid)) tasks.set(child.gid, child);
      if ((child.num_subtasks ?? 0) > 0 && !queuedParents.has(child.gid)) {
        queuedParents.add(child.gid);
        parents.push(child);
      }
    }
  }

  const taskValues = [...tasks.values()];
  const customTaskTypes = new Map<string, AsanaCustomType>();
  for (const row of projectRows)
    for (const type of row.customTaskTypes) customTaskTypes.set(type.gid, type);
  const missingCustomTaskTypeGids = [
    ...new Set(
      taskValues.flatMap((task) =>
        task.custom_type && !customTaskTypes.has(task.custom_type.gid)
          ? [task.custom_type.gid]
          : [],
      ),
    ),
  ];
  for (const type of await mapLimit(missingCustomTaskTypeGids, 4, (gid) =>
    adapter.getCustomType(gid),
  ))
    customTaskTypes.set(type.gid, type);
  const customTaskTypeMembershipRows = await mapLimit(
    [...customTaskTypes.values()],
    4,
    async (type) => ({
      customTaskTypeGid: type.gid,
      memberships: adapter.listCustomTypeMemberships
        ? await adapter.listCustomTypeMemberships(type.gid)
        : [],
    }),
  );
  let stories: Array<{ taskGid: string; story: AsanaStory }> | null = null;
  let attachments: Array<{
    taskGid: string;
    attachment: AsanaAttachment;
  }> | null = null;
  let timeTrackingEntries: Array<{
    taskGid: string;
    entry: AsanaTimeTrackingEntry;
  }> | null = null;
  let statusUpdates: AsanaWorkspaceScan["statusUpdates"] = null;
  if (depth === "full") {
    const content = await mapLimit(taskValues, 5, async (task) => {
      const [taskStories, taskAttachments, taskTimeTrackingEntries] =
        await Promise.all([
          adapter.listStories(task.gid),
          adapter.listAttachments(task.gid),
          adapter.listTimeTrackingEntries(task.gid),
        ]);
      return { taskStories, taskAttachments, taskTimeTrackingEntries };
    });
    stories = content.flatMap((row, index) =>
      row.taskStories.map((story) => ({
        taskGid: taskValues[index]!.gid,
        story,
      })),
    );
    attachments = content.flatMap((row, index) =>
      row.taskAttachments.map((attachment) => ({
        taskGid: taskValues[index]!.gid,
        attachment,
      })),
    );
    timeTrackingEntries = content.flatMap((row, index) =>
      row.taskTimeTrackingEntries.map((entry) => ({
        taskGid: taskValues[index]!.gid,
        entry,
      })),
    );
    const statusParents = [
      ...projects.map((parent) => ({ type: "project" as const, parent })),
      ...portfolios.map((parent) => ({ type: "portfolio" as const, parent })),
      ...goals.map((parent) => ({ type: "goal" as const, parent })),
    ];
    statusUpdates = (
      await mapLimit(statusParents, 5, async ({ type, parent }) =>
        (await adapter.listStatusUpdates(parent.gid)).map((status) => ({
          parentType: type,
          parentGid: parent.gid,
          status,
        })),
      )
    ).flat();
  }

  const tags = new Set<string>();
  const customFields = new Set<string>();
  for (const task of tasks.values()) {
    for (const tag of task.tags ?? []) tags.add(tag.gid);
    for (const field of task.custom_fields ?? []) customFields.add(field.gid);
  }
  for (const project of projects) {
    for (const setting of project.custom_field_settings ?? [])
      customFields.add(setting.custom_field.gid);
    for (const field of project.custom_fields ?? [])
      customFields.add(field.gid);
  }
  for (const portfolio of portfolios) {
    for (const setting of portfolio.custom_field_settings ?? [])
      customFields.add(setting.custom_field.gid);
    for (const field of portfolio.custom_fields ?? [])
      customFields.add(field.gid);
  }
  for (const goal of goals) {
    for (const setting of goal.custom_field_settings ?? [])
      customFields.add(setting.custom_field.gid);
    for (const field of goal.custom_fields ?? []) customFields.add(field.gid);
  }

  const selectedProjects = new Set(projects.map((project) => project.gid));
  const projectTaskIds = new Set(
    projectRows.flatMap((row) => row.tasks.map((task) => task.gid)),
  );
  const projectTasks = new Map<
    string,
    { projectGid: string; taskGid: string; sectionGid: string | null }
  >();
  for (const row of projectRows) {
    for (const task of row.tasks) {
      const membership = task.memberships?.find(
        (item) => item.project.gid === row.projectGid,
      );
      projectTasks.set(`${row.projectGid}:${task.gid}`, {
        projectGid: row.projectGid,
        taskGid: task.gid,
        sectionGid: membership?.section?.gid ?? null,
      });
    }
  }
  const taskProjectCounts = new Map<string, number>();
  for (const link of projectTasks.values()) {
    taskProjectCounts.set(
      link.taskGid,
      (taskProjectCounts.get(link.taskGid) ?? 0) + 1,
    );
  }
  for (const task of tasks.values()) {
    for (const membership of task.memberships ?? []) {
      if (!selectedProjects.has(membership.project.gid)) continue;
      projectTasks.set(`${membership.project.gid}:${task.gid}`, {
        projectGid: membership.project.gid,
        taskGid: task.gid,
        sectionGid: membership.section?.gid ?? null,
      });
    }
  }

  return {
    depth,
    users,
    teams,
    teamMemberships: teamRows.flatMap((row) =>
      row.memberships.map((membership) => ({
        teamGid: row.teamGid,
        membership,
      })),
    ),
    projects,
    projectMemberships: projectRows.flatMap((row) =>
      row.memberships.map((membership) => ({
        projectGid: row.projectGid,
        membership,
      })),
    ),
    sections: projectRows.flatMap((row) =>
      row.sections.map((section) => ({
        ...section,
        projectGid: row.projectGid,
      })),
    ),
    myTaskList,
    myTaskSections,
    myTasks: myTaskValues.map((task, position) => ({
      taskGid: task.gid,
      sectionGid: task.assignee_section?.gid ?? null,
      position,
      projectless: !projectTaskIds.has(task.gid),
    })),
    tasks: taskValues,
    projectTasks: [...projectTasks.values()],
    customTaskTypes: [...customTaskTypes.values()],
    customTaskTypeMemberships: customTaskTypeMembershipRows.flatMap((row) =>
      row.memberships.map((membership) => ({
        customTaskTypeGid: row.customTaskTypeGid,
        membership,
      })),
    ),
    projectCustomTaskTypes: projectRows.flatMap((row) =>
      row.customTaskTypes.map((type) => ({
        projectGid: row.projectGid,
        customTaskTypeGid: type.gid,
      })),
    ),
    stories,
    attachments,
    timeTrackingEntries,
    goals,
    goalRelationships: goalRows.flatMap((row) =>
      row.relationships.map((relationship) => ({
        goalGid: row.goalGid,
        relationship,
      })),
    ),
    portfolios,
    portfolioItems: portfolioRows.flatMap((row) =>
      row.items.map((project) => ({
        portfolioGid: row.portfolioGid,
        projectGid: project.gid,
      })),
    ),
    projectTemplates,
    taskTemplates: projectRows.flatMap((row) => row.taskTemplates),
    statusUpdates,
    counts: {
      users: users.length,
      teams: teams.length,
      teamMemberships: teamRows.reduce(
        (sum, row) => sum + row.memberships.length,
        0,
      ),
      projects: projects.length,
      projectMemberships: projectRows.reduce(
        (sum, row) => sum + row.memberships.length,
        0,
      ),
      sections: projectRows.reduce((sum, row) => sum + row.sections.length, 0),
      myTaskSections: myTaskSections.length,
      myTasks: myTaskValues.length,
      myTasksOnly: myTaskValues.filter((task) => !projectTaskIds.has(task.gid))
        .length,
      topLevelTasks: topLevelTaskIds.size,
      subtasks: tasks.size - topLevelTaskIds.size,
      tasks: tasks.size,
      projectTaskLinks: projectTasks.size,
      multiHomedTasks: [...taskProjectCounts.values()].filter(
        (count) => count > 1,
      ).length,
      tags: tags.size,
      customFields: customFields.size,
      objectCustomFieldValues:
        projects.reduce(
          (sum, project) => sum + (project.custom_fields?.length ?? 0),
          0,
        ) +
        portfolios.reduce(
          (sum, portfolio) => sum + (portfolio.custom_fields?.length ?? 0),
          0,
        ) +
        goals.reduce((sum, goal) => sum + (goal.custom_fields?.length ?? 0), 0),
      customTaskTypes: customTaskTypes.size,
      customTaskTypeMemberships: customTaskTypeMembershipRows.reduce(
        (sum, row) => sum + row.memberships.length,
        0,
      ),
      customTaskStatuses: [...customTaskTypes.values()].reduce(
        (sum, type) => sum + type.status_options.length,
        0,
      ),
      projectCustomTaskTypes: projectRows.reduce(
        (sum, row) => sum + row.customTaskTypes.length,
        0,
      ),
      stories: stories?.length ?? null,
      comments:
        stories?.filter(
          ({ story }) =>
            story.type === "comment" ||
            story.resource_subtype === "comment_added",
        ).length ?? null,
      attachments: attachments?.length ?? null,
      timeTrackingEntries: timeTrackingEntries?.length ?? null,
      goals: goals.length,
      goalRelationships: goalRows.reduce(
        (sum, row) => sum + row.relationships.length,
        0,
      ),
      portfolios: portfolios.length,
      portfolioItems: portfolioRows.reduce(
        (sum, row) => sum + row.items.length,
        0,
      ),
      projectTemplates: projectTemplates.length,
      taskTemplates: projectRows.reduce(
        (sum, row) => sum + row.taskTemplates.length,
        0,
      ),
      statusUpdates: statusUpdates?.length ?? null,
    },
  };
}
