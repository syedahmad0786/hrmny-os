"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type View = "list" | "board";

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

export default function WorkPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const projects = trpc.work.projects.list.useQuery();
  const employees = trpc.work.members.listEmployees.useQuery(undefined, {
    retry: false,
  });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPrivacy, setProjectPrivacy] = useState<
    "organization" | "private"
  >("organization");
  const [sectionName, setSectionName] = useState("");
  const [quickTasks, setQuickTasks] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [subtask, setSubtask] = useState("");
  const [dependencyId, setDependencyId] = useState("");

  useEffect(() => {
    if (!projectId && projects.data?.[0])
      setProjectId(projects.data[0].projectId);
  }, [projectId, projects.data]);

  const detail = trpc.work.projects.get.useQuery(
    { projectId: projectId! },
    { enabled: Boolean(projectId) },
  );
  const selectedItem =
    detail.data?.items.find((item) => item.itemId === selectedItemId) ?? null;
  const commentsEnabled =
    session.data?.enabledFeatureKeys.includes("work.comments") ?? false;
  const dependenciesEnabled =
    session.data?.enabledFeatureKeys.includes("work.dependencies") ?? false;
  const subtasksEnabled =
    session.data?.enabledFeatureKeys.includes("work.subtasks") ?? false;
  const sectionsEnabled =
    session.data?.enabledFeatureKeys.includes("work.sections") ?? false;
  const boardEnabled =
    session.data?.enabledFeatureKeys.includes("work.views.board") ?? false;
  const listEnabled =
    session.data?.enabledFeatureKeys.includes("work.views.list") ?? false;
  const comments = trpc.work.comments.list.useQuery(
    { itemId: selectedItemId! },
    { enabled: Boolean(selectedItemId && commentsEnabled) },
  );

  const refreshProject = async () => {
    await Promise.all([
      utils.work.projects.list.invalidate(),
      utils.work.projects.get.invalidate(),
    ]);
  };
  const createProject = trpc.work.projects.create.useMutation({
    onSuccess: async (created) => {
      setProjectId(created.projectId);
      setProjectName("");
      setNewProject(false);
      await refreshProject();
    },
  });
  const createSection = trpc.work.sections.create.useMutation({
    onSuccess: async () => {
      setSectionName("");
      await utils.work.projects.get.invalidate();
    },
  });
  const createTask = trpc.work.tasks.create.useMutation({
    onSuccess: async () => {
      setSubtask("");
      await utils.work.projects.get.invalidate();
    },
  });
  const completeTask = trpc.work.tasks.complete.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });
  const updateTask = trpc.work.tasks.update.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });
  const moveTask = trpc.work.tasks.move.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });
  const createComment = trpc.work.comments.create.useMutation({
    onSuccess: async () => {
      setComment("");
      await utils.work.comments.list.invalidate();
    },
  });
  const addDependency = trpc.work.dependencies.add.useMutation({
    onSuccess: async () => {
      setDependencyId("");
      await utils.work.projects.get.invalidate();
    },
  });
  const removeDependency = trpc.work.dependencies.remove.useMutation({
    onSuccess: () => utils.work.projects.get.invalidate(),
  });

  const sections = detail.data?.sections ?? [];
  const items = detail.data?.items ?? [];
  const topLevelItems = items.filter((item) => !item.parentItemId);
  const canEdit = ["admin", "editor"].includes(
    detail.data?.project.accessLevel ?? "viewer",
  );
  const canComment =
    canEdit || detail.data?.project.accessLevel === "commenter";
  const dependencies = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.itemId,
          (detail.data?.dependencies ?? [])
            .filter((dependency) => dependency.itemId === item.itemId)
            .map((dependency) => dependency.dependsOnItemId),
        ]),
      ),
    [detail.data?.dependencies, items],
  );
  const mutationError =
    createProject.error ??
    createSection.error ??
    createTask.error ??
    completeTask.error ??
    updateTask.error ??
    moveTask.error ??
    createComment.error ??
    addDependency.error ??
    removeDependency.error;

  function addQuickTask(sectionId: string | null) {
    if (!projectId) return;
    const key = sectionId ?? "none";
    const title = quickTasks[key]?.trim();
    if (!title) return;
    createTask.mutate({ projectId, sectionId, title, description: "" });
    setQuickTasks((current) => ({ ...current, [key]: "" }));
  }

  function taskRow(item: (typeof items)[number]) {
    const blockedBy = dependencies.get(item.itemId) ?? [];
    const blocked = blockedBy.some(
      (id) => !items.find((candidate) => candidate.itemId === id)?.completedAt,
    );
    return (
      <div
        key={item.itemId}
        className={`grid cursor-pointer gap-3 border-b border-sand/70 px-3 py-2.5 last:border-b-0 md:grid-cols-[auto_minmax(12rem,1fr)_10rem_9rem_8rem] md:items-center ${item.completedAt ? "bg-zinc-50 text-muted" : "bg-white/60"}`}
        onClick={() => setSelectedItemId(item.itemId)}
      >
        <input
          type="checkbox"
          aria-label={`Complete ${item.title}`}
          checked={Boolean(item.completedAt)}
          disabled={!canEdit || completeTask.isPending}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            completeTask.mutate({
              itemId: item.itemId,
              completed: event.target.checked,
            })
          }
          className="h-4 w-4 accent-[var(--ochre)]"
        />
        <div className="min-w-0">
          <p
            className={`truncate text-sm font-medium ${item.completedAt ? "line-through" : ""}`}
          >
            {item.title}
          </p>
          <div className="mt-0.5 flex gap-2 text-[10px] uppercase tracking-[0.08em] text-muted">
            {item.itemType !== "task" ? <span>{item.itemType}</span> : null}
            {blocked ? <span className="text-red-700">Blocked</span> : null}
            {items.some(
              (candidate) => candidate.parentItemId === item.itemId,
            ) ? (
              <span>
                {
                  items.filter(
                    (candidate) => candidate.parentItemId === item.itemId,
                  ).length
                }{" "}
                subtasks
              </span>
            ) : null}
          </div>
        </div>
        <span className="truncate text-xs text-muted">
          {item.assigneeName ?? "Unassigned"}
        </span>
        <span className="text-xs text-muted">
          {item.dueAt
            ? new Date(item.dueAt).toLocaleDateString()
            : "No due date"}
        </span>
        <span
          className={`w-fit rounded-full px-2 py-1 text-[10px] font-bold uppercase ${item.priority === "urgent" ? "bg-red-100 text-red-800" : item.priority === "high" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}
        >
          {item.priority ?? "normal"}
        </span>
      </div>
    );
  }

  return (
    <main className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Work management
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Projects & tasks
          </h1>
          <p className="mt-2 text-sm text-muted">
            One work graph for native hrmny projects and the future Asana
            migration.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white"
          onClick={() => setNewProject((value) => !value)}
        >
          + New project
        </button>
      </header>

      {mutationError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {mutationError.message}
        </p>
      ) : null}

      {newProject ? (
        <form
          className="grid gap-3 rounded-xl border border-sand bg-white/75 p-4 md:grid-cols-[1fr_12rem_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            createProject.mutate({
              name: projectName,
              description: "",
              privacy: projectPrivacy,
            });
          }}
        >
          <input
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Project name"
            required
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
          />
          <select
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={projectPrivacy}
            onChange={(event) =>
              setProjectPrivacy(event.target.value as typeof projectPrivacy)
            }
          >
            <option value="organization">Organization</option>
            <option value="private">Private</option>
          </select>
          <button
            className="rounded-lg bg-ochre px-4 py-2 text-sm font-medium text-white"
            disabled={!projectName.trim() || createProject.isPending}
          >
            Create
          </button>
        </form>
      ) : null}

      <div className="grid min-h-[36rem] overflow-hidden rounded-xl border border-sand bg-white/60 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-sand bg-[var(--paper)] p-3 xl:border-b-0 xl:border-r">
          <p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            Projects
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto xl:flex-col">
            {(projects.data ?? []).map((project) => (
              <button
                key={project.projectId}
                type="button"
                className={`min-w-48 rounded-lg px-3 py-2 text-left text-sm xl:min-w-0 ${projectId === project.projectId ? "bg-white font-medium shadow-sm" : "hover:bg-white/70"}`}
                onClick={() => {
                  setProjectId(project.projectId);
                  setSelectedItemId(null);
                }}
              >
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: project.color }}
                />
                {project.name}
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 p-4">
          {detail.isLoading ? (
            <p className="text-sm text-muted">Loading project…</p>
          ) : detail.data ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sand pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded"
                      style={{ background: detail.data.project.color }}
                    />
                    <h2 className="font-display text-2xl font-semibold">
                      {detail.data.project.name}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {detail.data.project.description ||
                      "No project description yet."}
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                    {detail.data.project.privacy} ·{" "}
                    {detail.data.project.accessLevel}
                  </p>
                </div>
                <div className="flex rounded-full border border-sand bg-white p-1 text-xs">
                  {listEnabled ? (
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 ${view === "list" ? "bg-ink text-white" : ""}`}
                      onClick={() => setView("list")}
                    >
                      List
                    </button>
                  ) : null}
                  {boardEnabled ? (
                    <button
                      type="button"
                      className={`rounded-full px-3 py-1.5 ${view === "board" ? "bg-ink text-white" : ""}`}
                      onClick={() => setView("board")}
                    >
                      Board
                    </button>
                  ) : null}
                </div>
              </div>

              {view === "board" && boardEnabled ? (
                <div className="mt-4 flex gap-4 overflow-x-auto pb-4">
                  {sections.map((section) => {
                    const sectionItems = topLevelItems.filter(
                      (item) => item.sectionId === section.sectionId,
                    );
                    return (
                      <div
                        key={section.sectionId}
                        className="w-72 shrink-0 rounded-xl bg-[var(--paper)] p-3"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">
                            {section.name}
                          </h3>
                          <span className="text-xs text-muted">
                            {sectionItems.length}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-col gap-2">
                          {sectionItems.map((item) => (
                            <button
                              key={item.itemId}
                              type="button"
                              className="rounded-lg border border-sand bg-white p-3 text-left shadow-sm"
                              onClick={() => setSelectedItemId(item.itemId)}
                            >
                              <p
                                className={`text-sm font-medium ${item.completedAt ? "line-through text-muted" : ""}`}
                              >
                                {item.title}
                              </p>
                              <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
                                <span>{item.assigneeName ?? "Unassigned"}</span>
                                <span>
                                  {item.dueAt
                                    ? new Date(item.dueAt).toLocaleDateString()
                                    : ""}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        {canEdit ? (
                          <form
                            className="mt-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              addQuickTask(section.sectionId);
                            }}
                          >
                            <input
                              className="w-full rounded-lg border border-dashed border-sand bg-white/70 px-3 py-2 text-sm"
                              placeholder="+ Add task"
                              value={quickTasks[section.sectionId] ?? ""}
                              onChange={(event) =>
                                setQuickTasks((current) => ({
                                  ...current,
                                  [section.sectionId]: event.target.value,
                                }))
                              }
                            />
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  {sections.map((section) => {
                    const sectionItems = topLevelItems.filter(
                      (item) => item.sectionId === section.sectionId,
                    );
                    return (
                      <section
                        key={section.sectionId}
                        className="overflow-hidden rounded-lg border border-sand"
                      >
                        <div className="flex items-center justify-between bg-[var(--paper)] px-3 py-2">
                          <h3 className="text-xs font-bold uppercase tracking-[0.1em]">
                            {section.name}
                          </h3>
                          <span className="text-xs text-muted">
                            {sectionItems.length}
                          </span>
                        </div>
                        {sectionItems.map(taskRow)}
                        {canEdit ? (
                          <form
                            className="border-t border-sand bg-white/50 p-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              addQuickTask(section.sectionId);
                            }}
                          >
                            <input
                              className="w-full bg-transparent px-2 py-1 text-sm outline-none"
                              placeholder="+ Add task"
                              value={quickTasks[section.sectionId] ?? ""}
                              onChange={(event) =>
                                setQuickTasks((current) => ({
                                  ...current,
                                  [section.sectionId]: event.target.value,
                                }))
                              }
                            />
                          </form>
                        ) : null}
                      </section>
                    );
                  })}
                  {sectionsEnabled && canEdit ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (projectId)
                          createSection.mutate({
                            projectId,
                            name: sectionName,
                          });
                      }}
                    >
                      <input
                        className="min-w-0 flex-1 rounded-lg border border-dashed border-sand bg-white/60 px-3 py-2 text-sm"
                        placeholder="New section"
                        value={sectionName}
                        onChange={(event) => setSectionName(event.target.value)}
                      />
                      <button
                        className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                        disabled={!sectionName.trim()}
                      >
                        Add section
                      </button>
                    </form>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-80 items-center justify-center text-sm text-muted">
              Create or select a project.
            </div>
          )}
        </section>
      </div>

      {selectedItem ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label={selectedItem.title}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedItemId(null);
          }}
        >
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-sand bg-[var(--paper)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(selectedItem.completedAt)}
                  disabled={!canEdit}
                  onChange={(event) =>
                    completeTask.mutate({
                      itemId: selectedItem.itemId,
                      completed: event.target.checked,
                    })
                  }
                  className="mt-1 h-5 w-5 accent-[var(--ochre)]"
                />
                <div>
                  <h2 className="font-display text-2xl font-semibold">
                    {selectedItem.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {detail.data?.project.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-full border border-sand bg-white px-3 py-1.5 text-sm"
                onClick={() => setSelectedItemId(null)}
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Assignee
                <select
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  value={selectedItem.assigneeEmployeeId ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateTask.mutate({
                      itemId: selectedItem.itemId,
                      assigneeEmployeeId: event.target.value || null,
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {(employees.data ?? []).map((employee) => (
                    <option
                      key={employee.employeeId}
                      value={employee.employeeId}
                    >
                      {employee.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Due date
                <input
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  type="date"
                  value={dateInputValue(selectedItem.dueAt)}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateTask.mutate({
                      itemId: selectedItem.itemId,
                      dueAt: event.target.value
                        ? new Date(
                            `${event.target.value}T17:00:00.000Z`,
                          ).toISOString()
                        : null,
                    })
                  }
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Priority
                <select
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  value={selectedItem.priority ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateTask.mutate({
                      itemId: selectedItem.itemId,
                      priority: (event.target.value ||
                        null) as typeof selectedItem.priority,
                    })
                  }
                >
                  <option value="">Normal</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                Section
                <select
                  className="mt-1 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                  value={selectedItem.sectionId ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    projectId &&
                    moveTask.mutate({
                      itemId: selectedItem.itemId,
                      projectId,
                      sectionId: event.target.value || null,
                      position: selectedItem.position,
                    })
                  }
                >
                  <option value="">No section</option>
                  {sections.map((section) => (
                    <option key={section.sectionId} value={section.sectionId}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-5 block text-xs font-bold uppercase tracking-[0.1em] text-muted">
              Description
              <textarea
                className="mt-1 min-h-28 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                defaultValue={selectedItem.description}
                readOnly={!canEdit}
                onBlur={(event) => {
                  if (event.target.value !== selectedItem.description)
                    updateTask.mutate({
                      itemId: selectedItem.itemId,
                      description: event.target.value,
                    });
                }}
              />
            </label>

            {subtasksEnabled ? (
              <section className="mt-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Subtasks
                </h3>
                <div className="mt-2 overflow-hidden rounded-lg border border-sand">
                  {items
                    .filter((item) => item.parentItemId === selectedItem.itemId)
                    .map(taskRow)}
                  {canEdit && projectId ? (
                    <form
                      className="flex gap-2 border-t border-sand bg-white/50 p-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        createTask.mutate({
                          projectId,
                          parentItemId: selectedItem.itemId,
                          sectionId: selectedItem.sectionId,
                          title: subtask,
                          description: "",
                        });
                      }}
                    >
                      <input
                        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none"
                        placeholder="Add subtask"
                        value={subtask}
                        onChange={(event) => setSubtask(event.target.value)}
                      />
                      <button
                        className="text-sm font-medium text-ochre"
                        disabled={!subtask.trim()}
                      >
                        Add
                      </button>
                    </form>
                  ) : null}
                </div>
              </section>
            ) : null}

            {dependenciesEnabled ? (
              <section className="mt-6">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Waiting on
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(dependencies.get(selectedItem.itemId) ?? []).map((id) => {
                    const dependency = items.find((item) => item.itemId === id);
                    return dependency ? (
                      <span
                        key={id}
                        className="flex items-center gap-2 rounded-full border border-sand bg-white px-3 py-1.5 text-xs"
                      >
                        {dependency.title}
                        {canEdit ? (
                          <button
                            type="button"
                            aria-label={`Remove ${dependency.title}`}
                            onClick={() =>
                              removeDependency.mutate({
                                itemId: selectedItem.itemId,
                                dependsOnItemId: id,
                              })
                            }
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ) : null;
                  })}
                </div>
                {canEdit ? (
                  <div className="mt-2 flex gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                      value={dependencyId}
                      onChange={(event) => setDependencyId(event.target.value)}
                    >
                      <option value="">Choose a task</option>
                      {items
                        .filter(
                          (item) =>
                            item.itemId !== selectedItem.itemId &&
                            !(
                              dependencies.get(selectedItem.itemId) ?? []
                            ).includes(item.itemId),
                        )
                        .map((item) => (
                          <option key={item.itemId} value={item.itemId}>
                            {item.title}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                      disabled={!dependencyId}
                      onClick={() =>
                        addDependency.mutate({
                          itemId: selectedItem.itemId,
                          dependsOnItemId: dependencyId,
                        })
                      }
                    >
                      Add
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {commentsEnabled ? (
              <section className="mt-6 border-t border-sand pt-5">
                <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Comments
                </h3>
                <div className="mt-3 flex flex-col gap-3">
                  {(comments.data ?? []).map((entry) => (
                    <div
                      key={entry.commentId}
                      className="rounded-lg border border-sand bg-white p-3"
                    >
                      <div className="flex justify-between gap-3 text-xs">
                        <strong>{entry.authorName}</strong>
                        <span className="text-muted">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm">
                        {entry.body}
                      </p>
                    </div>
                  ))}
                </div>
                {canComment ? (
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createComment.mutate({
                        itemId: selectedItem.itemId,
                        body: comment,
                      });
                    }}
                  >
                    <textarea
                      className="min-h-20 min-w-0 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                      placeholder="Write a comment"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                    />
                    <button
                      className="self-end rounded-lg bg-ochre px-4 py-2 text-sm font-medium text-white"
                      disabled={!comment.trim()}
                    >
                      Post
                    </button>
                  </form>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
