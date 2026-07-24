import type {
  AsanaAdapter,
  AsanaAttachment,
  AsanaProject,
  AsanaSection,
  AsanaStory,
  AsanaTask,
  AsanaUser,
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
  projects: AsanaProject[];
  sections: Array<AsanaSection & { projectGid: string }>;
  tasks: AsanaTask[];
  projectTasks: Array<{
    projectGid: string;
    taskGid: string;
    sectionGid: string | null;
  }>;
  stories: Array<{ taskGid: string; story: AsanaStory }> | null;
  attachments: Array<{ taskGid: string; attachment: AsanaAttachment }> | null;
  counts: {
    users: number;
    projects: number;
    sections: number;
    topLevelTasks: number;
    subtasks: number;
    tasks: number;
    projectTaskLinks: number;
    multiHomedTasks: number;
    tags: number;
    customFields: number;
    stories: number | null;
    comments: number | null;
    attachments: number | null;
  };
};

export async function scanAsanaWorkspace(
  adapter: AsanaAdapter,
  workspaceGid: string,
  depth: AsanaScanDepth = "full",
): Promise<AsanaWorkspaceScan> {
  const [users, projects] = await Promise.all([
    adapter.listUsers(workspaceGid),
    adapter.listProjects(workspaceGid),
  ]);
  const projectRows = await mapLimit(projects, 4, async (project) => {
    const [sections, tasks] = await Promise.all([
      adapter.listSections(project.gid),
      adapter.listProjectTasks(project.gid),
    ]);
    return { projectGid: project.gid, sections, tasks };
  });

  const tasks = new Map<string, AsanaTask>();
  for (const row of projectRows) {
    for (const task of row.tasks) {
      tasks.set(task.gid, task);
    }
  }
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
  let stories: Array<{ taskGid: string; story: AsanaStory }> | null = null;
  let attachments: Array<{
    taskGid: string;
    attachment: AsanaAttachment;
  }> | null = null;
  if (depth === "full") {
    const content = await mapLimit(taskValues, 5, async (task) => {
      const [taskStories, taskAttachments] = await Promise.all([
        adapter.listStories(task.gid),
        adapter.listAttachments(task.gid),
      ]);
      return { taskStories, taskAttachments };
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
  }

  const tags = new Set<string>();
  const customFields = new Set<string>();
  for (const task of tasks.values()) {
    for (const tag of task.tags ?? []) tags.add(tag.gid);
    for (const field of task.custom_fields ?? []) customFields.add(field.gid);
  }

  const selectedProjects = new Set(projects.map((project) => project.gid));
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
    projects,
    sections: projectRows.flatMap((row) =>
      row.sections.map((section) => ({
        ...section,
        projectGid: row.projectGid,
      })),
    ),
    tasks: taskValues,
    projectTasks: [...projectTasks.values()],
    stories,
    attachments,
    counts: {
      users: users.length,
      projects: projects.length,
      sections: projectRows.reduce((sum, row) => sum + row.sections.length, 0),
      topLevelTasks: topLevelTaskIds.size,
      subtasks: tasks.size - topLevelTaskIds.size,
      tasks: tasks.size,
      projectTaskLinks: projectTasks.size,
      multiHomedTasks: [...taskProjectCounts.values()].filter(
        (count) => count > 1,
      ).length,
      tags: tags.size,
      customFields: customFields.size,
      stories: stories?.length ?? null,
      comments:
        stories?.filter(
          ({ story }) =>
            story.type === "comment" ||
            story.resource_subtype === "comment_added",
        ).length ?? null,
      attachments: attachments?.length ?? null,
    },
  };
}
