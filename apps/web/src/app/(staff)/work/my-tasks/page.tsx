"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkNav } from "@/components/work-nav";
import {
  dueAtFromDateKey,
  dueDateKey,
  localDateKey,
  movePersonalCalendarAnchor,
  personalCalendarDateKeys,
  startOfWeek,
  type PersonalCalendarMode,
} from "@/lib/work-personal";
import { trpc } from "@/lib/trpc";

type View = "list" | "board" | "calendar";
type Sort = "due" | "priority" | "project" | "title";
type Group = "none" | "section" | "project" | "priority";
type DueFilter = "all" | "overdue" | "today" | "week" | "none";

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export default function MyTasksPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const enabled = new Set(session.data?.enabledFeatureKeys ?? []);
  const sectionsEnabled = enabled.has("work.my_tasks.sections");
  const focusEnabled = enabled.has("work.my_tasks.focus");
  const quickAddEnabled =
    enabled.has("work.my_tasks.quick_add") && enabled.has("work.tasks");
  const boardEnabled = sectionsEnabled && enabled.has("work.views.board");
  const calendarEnabled =
    enabled.has("work.views.calendar") &&
    enabled.has("work.views.calendar.week");
  const [query, setQuery] = useState("");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<Sort>("due");
  const [group, setGroup] = useState<Group>("none");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sectionName, setSectionName] = useState("");
  const [calendarMode, setCalendarMode] =
    useState<PersonalCalendarMode>("week");
  const [calendarAnchor, setCalendarAnchor] = useState(() =>
    localDateKey(new Date()),
  );
  const [showWeekends, setShowWeekends] = useState(true);
  const [weeklyFocus, setWeeklyFocus] = useState("");
  const [focusItemId, setFocusItemId] = useState("");
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDue, setQuickDue] = useState("");
  const [quickPriority, setQuickPriority] = useState<
    "" | "low" | "medium" | "high" | "urgent"
  >("");
  const [quickSectionId, setQuickSectionId] = useState("");
  const today = localDateKey(new Date());
  const weekStart = startOfWeek(today);
  const tasks = trpc.work.personal.myTasks.useQuery({
    query: query || undefined,
    includeCompleted,
  });
  type MyTask = NonNullable<typeof tasks.data>[number];
  const sections = trpc.work.personal.myTaskSections.list.useQuery(undefined, {
    enabled: sectionsEnabled,
  });
  const focus = trpc.work.personal.focus.get.useQuery(
    { weekStart },
    { enabled: focusEnabled },
  );
  useEffect(() => {
    if (focus.data) setWeeklyFocus(focus.data.focusText);
  }, [focus.data]);
  useEffect(() => {
    if (!focusRunning) return;
    const timer = window.setInterval(
      () =>
        setFocusSeconds((seconds) => {
          if (seconds > 1) return seconds - 1;
          setFocusRunning(false);
          return 0;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [focusRunning]);
  const refresh = () => {
    void utils.work.personal.myTasks.invalidate();
    void utils.work.personal.myTaskSections.list.invalidate();
  };
  const complete = trpc.work.tasks.complete.useMutation({ onSuccess: refresh });
  const updateTask = trpc.work.tasks.update.useMutation({ onSuccess: refresh });
  const createSection = trpc.work.personal.myTaskSections.create.useMutation({
    onSuccess: () => {
      setSectionName("");
      refresh();
    },
  });
  const renameSection = trpc.work.personal.myTaskSections.rename.useMutation({
    onSuccess: refresh,
  });
  const removeSection = trpc.work.personal.myTaskSections.remove.useMutation({
    onSuccess: refresh,
  });
  const reorderSections = trpc.work.personal.myTaskSections.reorder.useMutation(
    { onSuccess: refresh },
  );
  const moveTask = trpc.work.personal.myTaskSections.moveTask.useMutation({
    onSuccess: refresh,
  });
  const saveFocus = trpc.work.personal.focus.save.useMutation({
    onSuccess: () => utils.work.personal.focus.get.invalidate({ weekStart }),
  });
  const quickAdd = trpc.work.personal.quickAdd.useMutation({
    onSuccess: () => {
      setQuickTitle("");
      setQuickDue("");
      setQuickPriority("");
      setQuickSectionId("");
      refresh();
    },
  });
  const weekEnd = personalCalendarDateKeys(today, "week", true).at(-1)!;
  const sectionNames = new Map(
    (sections.data ?? []).map((section) => [section.sectionId, section.name]),
  );
  const filteredTasks = useMemo(() => {
    const rows = (tasks.data ?? []).filter((task) => {
      const due = dueDateKey(task.dueAt);
      if (dueFilter === "overdue") return Boolean(due && due < today);
      if (dueFilter === "today") return due === today;
      if (dueFilter === "week")
        return Boolean(due && due >= today && due <= weekEnd);
      if (dueFilter === "none") return !due;
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === "priority")
        return (
          (a.priority ? priorityRank[a.priority] : 4) -
          (b.priority ? priorityRank[b.priority] : 4)
        );
      if (sort === "project") return a.projectName.localeCompare(b.projectName);
      if (sort === "title") return a.title.localeCompare(b.title);
      return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
    });
  }, [dueFilter, sort, tasks.data, today, weekEnd]);
  const effectiveView =
    view === "board" && !boardEnabled
      ? "list"
      : view === "calendar" && !calendarEnabled
        ? "list"
        : view;
  const calendarDates = personalCalendarDateKeys(
    calendarAnchor,
    calendarMode,
    showWeekends,
  );
  const sectionIdFor = (task: MyTask) =>
    "personalSectionId" in task ? task.personalSectionId : null;
  const sectionPositionFor = (task: MyTask) =>
    "personalPosition" in task ? task.personalPosition : 0;
  const projectNameFor = (task: MyTask) =>
    "projectName" in task ? String(task.projectName) : "Work";
  const groupName = (task: MyTask) => {
    if (group === "section")
      return sectionNames.get(sectionIdFor(task) ?? "") ?? "Recently assigned";
    if (group === "project") return projectNameFor(task);
    if (group === "priority") return task.priority ?? "No priority";
    return "My tasks";
  };
  const groups = [
    ...filteredTasks.reduce((result, task) => {
      const name = groupName(task);
      const rows = result.get(name);
      if (rows) rows.push(task);
      else result.set(name, [task]);
      return result;
    }, new Map<string, MyTask[]>()),
  ].map(([name, rows]) => ({ name, rows }));
  const busy =
    complete.isPending ||
    updateTask.isPending ||
    moveTask.isPending ||
    reorderSections.isPending;
  const error =
    tasks.error ??
    sections.error ??
    complete.error ??
    updateTask.error ??
    createSection.error ??
    renameSection.error ??
    removeSection.error ??
    reorderSections.error ??
    moveTask.error ??
    focus.error ??
    saveFocus.error ??
    quickAdd.error;
  const schedule = (itemId: string, dateKey: string) =>
    updateTask.mutate({
      itemId,
      dueAt: dateKey ? dueAtFromDateKey(dateKey) : null,
    });
  const sectionSelect = (task: MyTask) =>
    sectionsEnabled ? (
      <select
        aria-label={`Section for ${task.title}`}
        className="rounded border border-sand bg-white px-2 py-1 text-xs"
        value={sectionIdFor(task) ?? ""}
        disabled={busy}
        onChange={(event) =>
          moveTask.mutate({
            itemId: task.itemId,
            sectionId: event.target.value || null,
            position: sectionPositionFor(task),
          })
        }
      >
        <option value="">Recently assigned</option>
        {(sections.data ?? []).map((section) => (
          <option key={section.sectionId} value={section.sectionId}>
            {section.name}
          </option>
        ))}
      </select>
    ) : null;
  const taskCard = (task: MyTask) => (
    <article
      key={task.itemId}
      className="flex flex-col gap-2 rounded-lg border border-sand bg-white p-3"
    >
      <label className="flex items-start gap-2">
        <input
          className="mt-1"
          type="checkbox"
          checked={Boolean(task.completedAt)}
          disabled={busy}
          onChange={(event) =>
            complete.mutate({
              itemId: task.itemId,
              completed: event.target.checked,
            })
          }
        />
        <span
          className={
            task.completedAt ? "line-through text-muted" : "font-medium"
          }
        >
          {task.title}
        </span>
      </label>
      <span className="text-xs text-muted">{projectNameFor(task)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label={`Due date for ${task.title}`}
          className="rounded border border-sand bg-white px-2 py-1 text-xs"
          value={dueDateKey(task.dueAt) ?? ""}
          disabled={busy}
          onChange={(event) => schedule(task.itemId, event.target.value)}
        />
        {sectionSelect(task)}
      </div>
    </article>
  );

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
          Personal work
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">My tasks</h1>
        <p className="mt-2 text-sm text-muted">
          Organize your assigned work privately across every project.
        </p>
      </header>

      {quickAddEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-4">
          <h2 className="text-sm font-semibold">Add a private task</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="min-w-64 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              maxLength={500}
              placeholder="Task name"
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && quickTitle.trim())
                  quickAdd.mutate({
                    title: quickTitle,
                    dueAt: quickDue ? dueAtFromDateKey(quickDue) : null,
                    priority: quickPriority || null,
                    personalSectionId: quickSectionId || null,
                  });
              }}
            />
            <input
              type="date"
              aria-label="Private task due date"
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              value={quickDue}
              onChange={(event) => setQuickDue(event.target.value)}
            />
            <select
              aria-label="Private task priority"
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              value={quickPriority}
              onChange={(event) =>
                setQuickPriority(event.target.value as typeof quickPriority)
              }
            >
              <option value="">No priority</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            {sectionsEnabled ? (
              <select
                aria-label="Private task section"
                className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                value={quickSectionId}
                onChange={(event) => setQuickSectionId(event.target.value)}
              >
                <option value="">Recently assigned</option>
                {(sections.data ?? []).map((section) => (
                  <option key={section.sectionId} value={section.sectionId}>
                    {section.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white"
              disabled={!quickTitle.trim() || quickAdd.isPending}
              onClick={() =>
                quickAdd.mutate({
                  title: quickTitle,
                  dueAt: quickDue ? dueAtFromDateKey(quickDue) : null,
                  priority: quickPriority || null,
                  personalSectionId: quickSectionId || null,
                })
              }
            >
              Add task
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Private tasks stay in My Tasks until you add them to a shared
            project.
          </p>
        </section>
      ) : null}

      {focusEnabled ? (
        <section className="grid gap-4 rounded-xl border border-sand bg-white/70 p-4 lg:grid-cols-2">
          <div>
            <label className="text-sm font-semibold" htmlFor="weekly-focus">
              This week&apos;s focus
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="weekly-focus"
                className="min-w-0 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                maxLength={500}
                placeholder="What matters most this week?"
                value={weeklyFocus}
                onChange={(event) => setWeeklyFocus(event.target.value)}
              />
              <button
                type="button"
                className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white"
                disabled={saveFocus.isPending}
                onClick={() =>
                  saveFocus.mutate({ weekStart, focusText: weeklyFocus })
                }
              >
                Save
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="focus-task">
              25-minute focus timer
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                id="focus-task"
                className="min-w-56 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                value={focusItemId}
                onChange={(event) => setFocusItemId(event.target.value)}
              >
                <option value="">Choose a task</option>
                {(tasks.data ?? [])
                  .filter((task) => !task.completedAt)
                  .map((task) => (
                    <option key={task.itemId} value={task.itemId}>
                      {task.title}
                    </option>
                  ))}
              </select>
              <strong
                className="min-w-16 text-center tabular-nums"
                aria-live="polite"
              >
                {String(Math.floor(focusSeconds / 60)).padStart(2, "0")}:
                {String(focusSeconds % 60).padStart(2, "0")}
              </strong>
              <button
                type="button"
                className="rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white"
                disabled={!focusItemId || focusSeconds === 0}
                onClick={() => setFocusRunning((running) => !running)}
              >
                {focusRunning ? "Pause" : "Focus"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                onClick={() => {
                  setFocusRunning(false);
                  setFocusSeconds(25 * 60);
                }}
              >
                Reset
              </button>
            </div>
            {focusRunning ? (
              <p className="mt-2 text-xs text-muted">
                Focus session active. Finish the task or pause the timer when
                interrupted.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="flex flex-wrap gap-3 rounded-xl border border-sand bg-white/70 p-3">
        <input
          className="min-w-64 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          placeholder="Filter my tasks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Sort tasks"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="due">Sort: due date</option>
          <option value="priority">Sort: priority</option>
          <option value="project">Sort: project</option>
          <option value="title">Sort: title</option>
        </select>
        <select
          aria-label="Group tasks"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={group}
          onChange={(event) => setGroup(event.target.value as Group)}
        >
          <option value="none">No grouping</option>
          {sectionsEnabled ? (
            <option value="section">Group: section</option>
          ) : null}
          <option value="project">Group: project</option>
          <option value="priority">Group: priority</option>
        </select>
        <select
          aria-label="Filter by due date"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={dueFilter}
          onChange={(event) => setDueFilter(event.target.value as DueFilter)}
        >
          <option value="all">All dates</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="none">No due date</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(event) => setIncludeCompleted(event.target.checked)}
          />
          Show completed
        </label>
      </section>

      <div className="flex flex-wrap gap-2" aria-label="My Tasks views">
        {(
          [
            "list",
            ...(boardEnabled ? ["board"] : []),
            ...(calendarEnabled ? ["calendar"] : []),
          ] as View[]
        ).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`rounded-full border px-3 py-1.5 text-sm capitalize ${effectiveView === candidate ? "border-ink bg-ink text-white" : "border-sand bg-white"}`}
            onClick={() => setView(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>

      {sectionsEnabled ? (
        <section className="overflow-x-auto rounded-xl border border-sand bg-white/70 p-4">
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-56 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              placeholder="New private section"
              value={sectionName}
              onChange={(event) => setSectionName(event.target.value)}
            />
            <button
              type="button"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white"
              disabled={!sectionName.trim() || createSection.isPending}
              onClick={() => createSection.mutate({ name: sectionName })}
            >
              Add section
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(sections.data ?? []).map((section, index, all) => (
              <span
                key={section.sectionId}
                className="inline-flex items-center gap-1 rounded-full border border-sand bg-white px-2 py-1 text-sm"
              >
                {section.name}
                <button
                  type="button"
                  aria-label={`Move ${section.name} up`}
                  disabled={busy || index === 0}
                  onClick={() => {
                    const ids = all.map((item) => item.sectionId);
                    [ids[index - 1], ids[index]] = [
                      ids[index]!,
                      ids[index - 1]!,
                    ];
                    reorderSections.mutate({ sectionIds: ids });
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${section.name} down`}
                  disabled={busy || index === all.length - 1}
                  onClick={() => {
                    const ids = all.map((item) => item.sectionId);
                    [ids[index], ids[index + 1]] = [
                      ids[index + 1]!,
                      ids[index]!,
                    ];
                    reorderSections.mutate({ sectionIds: ids });
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Rename ${section.name}`}
                  disabled={busy}
                  onClick={() => {
                    const name = window
                      .prompt("Rename section", section.name)
                      ?.trim();
                    if (name)
                      renameSection.mutate({
                        sectionId: section.sectionId,
                        name,
                      });
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${section.name}`}
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${section.name}? Its tasks will return to Recently assigned.`,
                      )
                    )
                      removeSection.mutate({ sectionId: section.sectionId });
                  }}
                >
                  Delete
                </button>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {effectiveView === "list" ? (
        <div className="flex flex-col gap-4">
          {groups.map((taskGroup) => (
            <section
              key={taskGroup.name}
              className="overflow-hidden rounded-xl border border-sand bg-white/70"
            >
              <h2 className="border-b border-sand px-4 py-3 font-semibold">
                {taskGroup.name}
              </h2>
              <div className="divide-y divide-sand">
                {taskGroup.rows.map((task) => (
                  <div
                    key={task.itemId}
                    className="grid gap-3 px-4 py-3 md:grid-cols-[auto_1fr_12rem_13rem_7rem] md:items-center"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Complete ${task.title}`}
                      checked={Boolean(task.completedAt)}
                      disabled={busy}
                      onChange={(event) =>
                        complete.mutate({
                          itemId: task.itemId,
                          completed: event.target.checked,
                        })
                      }
                    />
                    <div>
                      <p
                        className={
                          task.completedAt
                            ? "line-through text-muted"
                            : "font-medium"
                        }
                      >
                        {task.title}
                      </p>
                      <p className="text-xs text-muted">
                        {projectNameFor(task)}
                      </p>
                    </div>
                    <input
                      type="date"
                      aria-label={`Due date for ${task.title}`}
                      className="rounded border border-sand bg-white px-2 py-1 text-sm"
                      value={dueDateKey(task.dueAt) ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        schedule(task.itemId, event.target.value)
                      }
                    />
                    {sectionSelect(task)}
                    <span className="text-xs font-bold uppercase text-muted">
                      {task.priority ?? "normal"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {effectiveView === "board" ? (
        <section className="flex gap-4 overflow-x-auto pb-2">
          {[
            { sectionId: null, name: "Recently assigned" },
            ...(sections.data ?? []),
          ].map((section) => (
            <div
              key={section.sectionId ?? "recent"}
              className="w-80 shrink-0 rounded-xl border border-sand bg-white/70 p-3"
            >
              <h2 className="mb-3 font-semibold">{section.name}</h2>
              <div className="flex flex-col gap-3">
                {filteredTasks
                  .filter((task) => sectionIdFor(task) === section.sectionId)
                  .map(taskCard)}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {effectiveView === "calendar" ? (
        <section className="rounded-xl border border-sand bg-white/70 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-sand bg-white px-3 py-1.5"
              onClick={() =>
                setCalendarAnchor(
                  movePersonalCalendarAnchor(calendarAnchor, calendarMode, -1),
                )
              }
            >
              ←
            </button>
            <button
              type="button"
              className="rounded border border-sand bg-white px-3 py-1.5"
              onClick={() => setCalendarAnchor(today)}
            >
              Today
            </button>
            <button
              type="button"
              className="rounded border border-sand bg-white px-3 py-1.5"
              onClick={() =>
                setCalendarAnchor(
                  movePersonalCalendarAnchor(calendarAnchor, calendarMode, 1),
                )
              }
            >
              →
            </button>
            <strong className="mr-auto">
              {new Date(`${calendarAnchor}T12:00:00`).toLocaleDateString(
                undefined,
                { month: "long", year: "numeric" },
              )}
            </strong>
            <select
              className="rounded border border-sand bg-white px-2 py-1.5 text-sm"
              value={calendarMode}
              onChange={(event) =>
                setCalendarMode(event.target.value as PersonalCalendarMode)
              }
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showWeekends}
                onChange={(event) => setShowWeekends(event.target.checked)}
              />
              Weekends
            </label>
          </div>
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${showWeekends ? 7 : 5}, minmax(9rem, 1fr))`,
            }}
          >
            {calendarDates.map((dateKey) => (
              <div
                key={dateKey}
                className={`min-h-40 rounded-lg border border-sand p-2 ${dateKey === today ? "bg-amber-50" : "bg-white"}`}
              >
                <h3 className="mb-2 text-xs font-bold uppercase text-muted">
                  {new Date(`${dateKey}T12:00:00`).toLocaleDateString(
                    undefined,
                    { weekday: "short", month: "short", day: "numeric" },
                  )}
                </h3>
                <div className="flex flex-col gap-2">
                  {filteredTasks
                    .filter((task) => dueDateKey(task.dueAt) === dateKey)
                    .map(taskCard)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-sand p-3">
            <h2 className="mb-3 font-semibold">No date</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredTasks.filter((task) => !task.dueAt).map(taskCard)}
            </div>
          </div>
        </section>
      ) : null}

      {!tasks.isLoading && !filteredTasks.length ? (
        <p className="rounded-xl border border-sand bg-white/70 p-8 text-center text-sm text-muted">
          No matching tasks.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error.message}</p> : null}
    </main>
  );
}
