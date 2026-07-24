"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { WorkLikeButton } from "@/components/work-like-button";
import {
  WorkRichText,
  WorkRichTextEditor,
  type WorkMentionOption,
} from "@/components/work-rich-text";
import { trpc } from "@/lib/trpc";

function monday() {
  const value = new Date();
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

function hours(minutes: number) {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

export default function PlanningPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const projects = trpc.work.projects.list.useQuery();
  const [projectId, setProjectId] = useState("");
  const employees = trpc.work.members.listEmployees.useQuery({
    projectId: projectId || undefined,
  });
  const [weekStart, setWeekStart] = useState(monday);
  useEffect(() => {
    if (!projectId && projects.data?.[0])
      setProjectId(projects.data[0].projectId);
  }, [projectId, projects.data]);

  const detail = trpc.work.projects.get.useQuery(
    { projectId },
    { enabled: Boolean(projectId) },
  );
  const enabled = useMemo(
    () =>
      new Set(
        detail.data?.enabledFeatureKeys ??
          (projectId ? [] : session.data?.enabledFeatureKeys) ??
          [],
      ),
    [
      detail.data?.enabledFeatureKeys,
      projectId,
      session.data?.enabledFeatureKeys,
    ],
  );
  const goalsEnabled = enabled.has("work.goals");
  const portfoliosEnabled = enabled.has("work.portfolios");
  const statusEnabled = enabled.has("work.status_updates");
  const reportingEnabled = enabled.has("work.reporting_dashboards");
  const workloadEnabled = enabled.has("work.workload");
  const capacityEnabled = enabled.has("work.capacity_planning");
  const budgetsEnabled = enabled.has("work.budgets");
  const timeEnabled = enabled.has("work.time_tracking");
  const ganttEnabled = enabled.has("work.views.gantt");
  const richTextEnabled = enabled.has("work.rich_text");
  const goals = trpc.work.goals.list.useQuery(undefined, {
    enabled: goalsEnabled,
  });
  const portfolios = trpc.work.portfolios.list.useQuery(undefined, {
    enabled: portfoliosEnabled,
  });
  const statusUpdates = trpc.work.statusUpdates.list.useQuery(
    { targetType: "project", targetId: projectId },
    { enabled: Boolean(projectId && statusEnabled) },
  );
  const report = trpc.work.reporting.summary.useQuery(
    { projectId },
    { enabled: Boolean(projectId && reportingEnabled) },
  );
  const dashboards = trpc.work.reporting.dashboards.useQuery(undefined, {
    enabled: reportingEnabled,
  });
  const exportReport = trpc.work.reporting.exportProject.useQuery(
    { projectId },
    { enabled: false },
  );
  const workload = trpc.work.workload.list.useQuery(
    { projectId, weekStart },
    { enabled: Boolean(projectId && workloadEnabled) },
  );
  const budget = trpc.work.budgets.summary.useQuery(
    { projectId },
    { enabled: Boolean(projectId && budgetsEnabled) },
  );
  const entries = trpc.work.time.list.useQuery(
    { projectId },
    { enabled: Boolean(projectId && timeEnabled) },
  );
  const timer = trpc.work.time.activeTimer.useQuery(undefined, {
    enabled: timeEnabled,
  });
  const gantt = trpc.work.gantt.get.useQuery(
    { projectId },
    { enabled: Boolean(projectId && ganttEnabled) },
  );
  const mentionOptions: WorkMentionOption[] = [
    ...(employees.data ?? []).map((employee) => ({
      id: employee.employeeId,
      label: employee.displayName,
      type: "person" as const,
    })),
    ...(projects.data ?? []).map((project) => ({
      id: project.projectId,
      label: project.name,
      type: "project" as const,
    })),
    ...(detail.data?.items ?? []).map((item) => ({
      id: item.itemId,
      label: item.title,
      type: "task" as const,
    })),
  ];

  const [goalName, setGoalName] = useState("");
  const [goalDueDate, setGoalDueDate] = useState("");
  const createGoal = trpc.work.goals.create.useMutation({
    onSuccess: async () => {
      setGoalName("");
      await utils.work.goals.list.invalidate();
    },
  });
  const linkGoal = trpc.work.goals.link.useMutation({
    onSuccess: () => utils.work.goals.list.invalidate(),
  });

  const [portfolioName, setPortfolioName] = useState("");
  const createPortfolio = trpc.work.portfolios.create.useMutation({
    onSuccess: async () => {
      setPortfolioName("");
      await utils.work.portfolios.list.invalidate();
    },
  });
  const addPortfolioProject = trpc.work.portfolios.addProject.useMutation({
    onSuccess: () => utils.work.portfolios.list.invalidate(),
  });

  const [statusTitle, setStatusTitle] = useState("");
  const [statusBody, setStatusBody] = useState("");
  const [health, setHealth] = useState<
    "on_track" | "at_risk" | "off_track" | "complete"
  >("on_track");
  const createStatus = trpc.work.statusUpdates.create.useMutation({
    onSuccess: async () => {
      setStatusTitle("");
      setStatusBody("");
      await utils.work.statusUpdates.list.invalidate();
    },
  });

  const [dashboardName, setDashboardName] = useState("");
  const saveDashboard = trpc.work.reporting.saveDashboard.useMutation({
    onSuccess: async () => {
      setDashboardName("");
      await utils.work.reporting.dashboards.invalidate();
    },
  });

  const [budgetAmount, setBudgetAmount] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const updateBudget = trpc.work.budgets.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.budgets.summary.invalidate(),
        utils.work.reporting.summary.invalidate(),
      ]);
    },
  });

  const [allocationEmployeeId, setAllocationEmployeeId] = useState("");
  const [allocationHours, setAllocationHours] = useState("");
  useEffect(() => {
    if (!allocationEmployeeId && employees.data?.[0])
      setAllocationEmployeeId(employees.data[0].employeeId);
  }, [allocationEmployeeId, employees.data]);
  const upsertAllocation = trpc.work.workload.upsert.useMutation({
    onSuccess: () => utils.work.workload.list.invalidate(),
  });

  const [timeDate, setTimeDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [timeMinutes, setTimeMinutes] = useState("60");
  const [timeItemId, setTimeItemId] = useState("");
  const [timeDescription, setTimeDescription] = useState("");
  const logTime = trpc.work.time.log.useMutation({
    onSuccess: async () => {
      setTimeDescription("");
      await Promise.all([
        utils.work.time.list.invalidate(),
        utils.work.reporting.summary.invalidate(),
        utils.work.budgets.summary.invalidate(),
      ]);
    },
  });
  const removeTime = trpc.work.time.remove.useMutation({
    onSuccess: () => utils.work.time.list.invalidate(),
  });
  const startTimer = trpc.work.time.startTimer.useMutation({
    onSuccess: () => utils.work.time.activeTimer.invalidate(),
  });
  const stopTimer = trpc.work.time.stopTimer.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.time.activeTimer.invalidate(),
        utils.work.time.list.invalidate(),
      ]);
    },
  });
  const discardTimer = trpc.work.time.discardTimer.useMutation({
    onSuccess: () => utils.work.time.activeTimer.invalidate(),
  });

  const captureBaseline = trpc.work.gantt.captureBaseline.useMutation({
    onSuccess: () => utils.work.gantt.get.invalidate(),
  });

  const errors = [
    createGoal.error,
    linkGoal.error,
    createPortfolio.error,
    addPortfolioProject.error,
    createStatus.error,
    saveDashboard.error,
    updateBudget.error,
    upsertAllocation.error,
    logTime.error,
    removeTime.error,
    startTimer.error,
    stopTimer.error,
    discardTimer.error,
    captureBaseline.error,
  ].filter(Boolean);

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Plan and measure
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Planning</h1>
          <p className="mt-2 text-sm text-muted">
            Connect strategy, delivery, capacity, time, and cost in one place.
          </p>
        </div>
        <select
          aria-label="Project"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          {(projects.data ?? []).map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
        </select>
      </header>

      {errors[0] ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {errors[0]!.message}
        </p>
      ) : null}

      {reportingEnabled && report.data ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Live overview</h2>
              <p className="text-sm text-muted">
                Updates automatically as work changes.
              </p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveDashboard.mutate({
                  name: dashboardName,
                  config: { projectId, view: "overview" },
                });
              }}
            >
              <input
                aria-label="Dashboard name"
                className="rounded border border-sand px-3 py-2 text-sm"
                placeholder="Dashboard name"
                value={dashboardName}
                onChange={(event) => setDashboardName(event.target.value)}
              />
              <button
                className="rounded bg-ink px-3 py-2 text-sm text-white"
                disabled={!dashboardName.trim()}
              >
                Save view
              </button>
              <button
                type="button"
                className="rounded border border-sand px-3 py-2 text-sm"
                onClick={async () => {
                  const result = await exportReport.refetch();
                  if (!result.data) return;
                  const url = URL.createObjectURL(
                    new Blob([result.data.csv], {
                      type: result.data.contentType,
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = result.data.fileName;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export
              </button>
            </form>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Progress", `${report.data.progress}%`],
              [
                "Completed",
                `${report.data.completedTasks}/${report.data.totalTasks}`,
              ],
              ["Overdue", report.data.overdueTasks],
              ["Unassigned", report.data.unassignedTasks],
              ["Tracked", hours(report.data.actualMinutes)],
            ].map(([label, value]) => (
              <article
                key={label}
                className="rounded-lg border border-sand bg-white p-3"
              >
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </article>
            ))}
          </div>
          {(dashboards.data ?? []).length ? (
            <p className="mt-3 text-xs text-muted">
              Saved views:{" "}
              {(dashboards.data ?? []).map((item) => item.name).join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {goalsEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Goals</h2>
          <form
            className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              createGoal.mutate({
                name: goalName,
                description: "",
                dueDate: goalDueDate || null,
              });
            }}
          >
            <input
              className="rounded border border-sand px-3 py-2"
              placeholder="New goal"
              value={goalName}
              onChange={(event) => setGoalName(event.target.value)}
            />
            <input
              aria-label="Goal due date"
              className="rounded border border-sand px-3 py-2"
              type="date"
              value={goalDueDate}
              onChange={(event) => setGoalDueDate(event.target.value)}
            />
            <button
              className="rounded bg-ink px-4 py-2 text-white"
              disabled={!goalName.trim()}
            >
              Create goal
            </button>
          </form>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(goals.data ?? []).map((goal) => (
              <article
                key={goal.goalId}
                className="rounded-lg border border-sand bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{goal.name}</h3>
                    <p className="text-xs capitalize text-muted">
                      {goal.status.replaceAll("_", " ")}
                    </p>
                  </div>
                  <span className="text-lg font-semibold">
                    {goal.progress}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand">
                  <div
                    className="h-full bg-ochre"
                    style={{ width: `${goal.progress}%` }}
                  />
                </div>
                {projectId ? (
                  <button
                    type="button"
                    className="mt-3 rounded border border-sand px-3 py-1.5 text-xs"
                    onClick={() =>
                      linkGoal.mutate({
                        goalId: goal.goalId,
                        target: { type: "project", id: projectId },
                      })
                    }
                  >
                    Link selected project
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {portfoliosEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Portfolios</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createPortfolio.mutate({ name: portfolioName, description: "" });
            }}
          >
            <input
              className="min-w-0 flex-1 rounded border border-sand px-3 py-2"
              placeholder="Portfolio name"
              value={portfolioName}
              onChange={(event) => setPortfolioName(event.target.value)}
            />
            <button
              className="rounded bg-ink px-4 py-2 text-white"
              disabled={!portfolioName.trim()}
            >
              Create
            </button>
          </form>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(portfolios.data ?? []).map((portfolio) => (
              <article
                key={portfolio.portfolioId}
                className="rounded-lg border border-sand bg-white p-4"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{portfolio.name}</h3>
                    <p className="text-xs capitalize text-muted">
                      {portfolio.health.replaceAll("_", " ")} ·{" "}
                      {portfolio.projectIds.length} projects
                    </p>
                  </div>
                  <span className="font-semibold">{portfolio.progress}%</span>
                </div>
                {projectId && !portfolio.projectIds.includes(projectId) ? (
                  <button
                    type="button"
                    className="mt-3 rounded border border-sand px-3 py-1.5 text-xs"
                    onClick={() =>
                      addPortfolioProject.mutate({
                        portfolioId: portfolio.portfolioId,
                        projectId,
                      })
                    }
                  >
                    Add selected project
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {statusEnabled && projectId ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Status updates</h2>
          <form
            className="mt-3 grid gap-2 md:grid-cols-[1fr_2fr_auto_auto] md:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              createStatus.mutate({
                targetType: "project",
                targetId: projectId,
                health,
                progress: report.data?.progress ?? null,
                title: statusTitle,
                body: statusBody,
              });
            }}
          >
            <input
              className="rounded border border-sand px-3 py-2"
              placeholder="Update title"
              value={statusTitle}
              onChange={(event) => setStatusTitle(event.target.value)}
            />
            {richTextEnabled ? (
              <WorkRichTextEditor
                ariaLabel="Status update body"
                maxLength={50_000}
                mentions={mentionOptions}
                placeholder="What changed?"
                value={statusBody}
                onChange={setStatusBody}
              />
            ) : (
              <input
                aria-label="Status update body"
                className="rounded border border-sand px-3 py-2"
                maxLength={50_000}
                placeholder="What changed?"
                value={statusBody}
                onChange={(event) => setStatusBody(event.target.value)}
              />
            )}
            <select
              aria-label="Health"
              className="rounded border border-sand px-3 py-2"
              value={health}
              onChange={(event) =>
                setHealth(event.target.value as typeof health)
              }
            >
              <option value="on_track">On track</option>
              <option value="at_risk">At risk</option>
              <option value="off_track">Off track</option>
              <option value="complete">Complete</option>
            </select>
            <button
              className="rounded bg-ink px-4 py-2 text-white"
              disabled={!statusTitle.trim()}
            >
              Post update
            </button>
          </form>
          <div className="mt-4 space-y-2">
            {(statusUpdates.data ?? []).map((update) => (
              <article
                key={update.statusUpdateId}
                className="rounded-lg border border-sand bg-white p-3"
              >
                <div className="flex justify-between gap-3">
                  <h3 className="font-semibold">{update.title}</h3>
                  <span className="text-xs capitalize text-muted">
                    {update.health.replaceAll("_", " ")}
                  </span>
                </div>
                {richTextEnabled ? (
                  <WorkRichText
                    className="mt-1 text-sm text-muted"
                    value={update.body}
                  />
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                    {update.body}
                  </p>
                )}
                <div className="mt-2">
                  <WorkLikeButton
                    targetType="status_update"
                    targetId={update.statusUpdateId}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {budgetsEnabled && budget.data ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <h2 className="font-display text-xl">Budget</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <p>
              <span className="block text-xs text-muted">Actual cost</span>
              {budget.data.budgetCurrency}{" "}
              {budget.data.actualCost.toLocaleString()}
            </p>
            <p>
              <span className="block text-xs text-muted">Forecast</span>
              {budget.data.budgetCurrency}{" "}
              {budget.data.forecastCost.toLocaleString()}
            </p>
            <p>
              <span className="block text-xs text-muted">
                Forecast variance
              </span>
              {budget.data.variance === null
                ? "No budget"
                : `${budget.data.budgetCurrency} ${budget.data.variance.toLocaleString()}`}
            </p>
          </div>
          <form
            className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              updateBudget.mutate({
                projectId,
                budgetAmount: budgetAmount ? Number(budgetAmount) : null,
                budgetCurrency: budget.data!.budgetCurrency,
                hourlyCostRate: hourlyRate ? Number(hourlyRate) : null,
              });
            }}
          >
            <input
              aria-label="Project budget"
              className="rounded border border-sand px-3 py-2"
              type="number"
              min="0"
              placeholder={
                budget.data.budgetAmount?.toString() ?? "Project budget"
              }
              value={budgetAmount}
              onChange={(event) => setBudgetAmount(event.target.value)}
            />
            <input
              aria-label="Hourly cost rate"
              className="rounded border border-sand px-3 py-2"
              type="number"
              min="0"
              placeholder={
                budget.data.hourlyCostRate?.toString() ?? "Hourly cost rate"
              }
              value={hourlyRate}
              onChange={(event) => setHourlyRate(event.target.value)}
            />
            <button className="rounded bg-ink px-4 py-2 text-white">
              Save budget
            </button>
          </form>
        </section>
      ) : null}

      {workloadEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Workload</h2>
              <p className="text-sm text-muted">
                Planned work compared with weekly capacity.
              </p>
            </div>
            <input
              aria-label="Week starting"
              className="rounded border border-sand px-3 py-2"
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
            />
          </div>
          {capacityEnabled ? (
            <form
              className="mt-4 grid gap-2 md:grid-cols-[2fr_1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                upsertAllocation.mutate({
                  projectId,
                  employeeId: allocationEmployeeId,
                  weekStart,
                  allocatedMinutes: Math.round(Number(allocationHours) * 60),
                  roleName: null,
                });
              }}
            >
              <select
                aria-label="Employee"
                className="rounded border border-sand px-3 py-2"
                value={allocationEmployeeId}
                onChange={(event) =>
                  setAllocationEmployeeId(event.target.value)
                }
              >
                {(employees.data ?? []).map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayLabel}
                  </option>
                ))}
              </select>
              <input
                aria-label="Allocated hours"
                className="rounded border border-sand px-3 py-2"
                type="number"
                min="0"
                max="168"
                step="0.5"
                placeholder="Hours"
                value={allocationHours}
                onChange={(event) => setAllocationHours(event.target.value)}
              />
              <button
                className="rounded bg-ink px-4 py-2 text-white"
                disabled={!allocationEmployeeId || !allocationHours}
              >
                Allocate
              </button>
            </form>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand text-xs text-muted">
                  <th className="py-2">Person</th>
                  <th>Capacity</th>
                  <th>Allocated</th>
                  <th>Assigned</th>
                  <th>Actual</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                {(workload.data ?? []).map((row) => (
                  <tr key={row.employeeId} className="border-b border-sand/70">
                    <td className="py-2 font-medium">{row.displayName}</td>
                    <td>{row.capacityHours}h</td>
                    <td>{hours(row.allocatedMinutes)}</td>
                    <td>{hours(row.assignedMinutes)}</td>
                    <td>{hours(row.actualMinutes)}</td>
                    <td
                      className={
                        row.utilization > 100
                          ? "font-semibold text-red-700"
                          : ""
                      }
                    >
                      {row.utilization}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {timeEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Time</h2>
              <p className="text-sm text-muted">
                Track estimated and actual effort against work.
              </p>
            </div>
            {timer.data ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded bg-ochre px-3 py-2 text-sm text-white"
                  onClick={() =>
                    stopTimer.mutate({
                      timerId: timer.data!.timerId,
                      isBillable: false,
                    })
                  }
                >
                  Stop timer
                </button>
                <button
                  type="button"
                  className="rounded border border-sand px-3 py-2 text-sm"
                  onClick={() =>
                    discardTimer.mutate({ timerId: timer.data!.timerId })
                  }
                >
                  Discard
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="rounded bg-ochre px-3 py-2 text-sm text-white"
                disabled={!projectId}
                onClick={() =>
                  startTimer.mutate({
                    projectId,
                    itemId: timeItemId || null,
                    description: timeDescription || null,
                  })
                }
              >
                Start timer
              </button>
            )}
          </div>
          <form
            className="mt-4 grid gap-2 md:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              logTime.mutate({
                projectId,
                itemId: timeItemId || null,
                workDate: timeDate,
                minutes: Number(timeMinutes),
                isBillable: false,
                description: timeDescription || null,
              });
            }}
          >
            <input
              aria-label="Work date"
              className="rounded border border-sand px-3 py-2"
              type="date"
              value={timeDate}
              onChange={(event) => setTimeDate(event.target.value)}
            />
            <input
              aria-label="Minutes"
              className="rounded border border-sand px-3 py-2"
              type="number"
              min="1"
              max="1440"
              value={timeMinutes}
              onChange={(event) => setTimeMinutes(event.target.value)}
            />
            <select
              aria-label="Task"
              className="rounded border border-sand px-3 py-2"
              value={timeItemId}
              onChange={(event) => setTimeItemId(event.target.value)}
            >
              <option value="">Project only</option>
              {(detail.data?.items ?? []).map((item) => (
                <option key={item.itemId} value={item.itemId}>
                  {item.title}
                </option>
              ))}
            </select>
            <input
              aria-label="Time note"
              className="rounded border border-sand px-3 py-2"
              placeholder="What did you work on?"
              value={timeDescription}
              onChange={(event) => setTimeDescription(event.target.value)}
            />
            <button className="rounded bg-ink px-4 py-2 text-white">
              Log time
            </button>
          </form>
          <div className="mt-4 space-y-2">
            {(entries.data ?? []).slice(0, 10).map((entry) => (
              <div
                key={entry.timeEntryId}
                className="flex items-center justify-between gap-3 rounded border border-sand bg-white p-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {entry.workDate} · {entry.description || "Project work"}
                </span>
                <strong>{hours(entry.minutes)}</strong>
                {["draft", "rejected"].includes(entry.status) ? (
                  <button
                    type="button"
                    className="rounded border border-sand px-2 py-1 text-xs"
                    onClick={() =>
                      removeTime.mutate({ timeEntryId: entry.timeEntryId })
                    }
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {ganttEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Gantt plan</h2>
              <p className="text-sm text-muted">
                Dates, dependencies, critical path, and variance from baseline.
              </p>
            </div>
            <button
              type="button"
              className="rounded border border-sand px-3 py-2 text-sm"
              disabled={!projectId}
              onClick={() => captureBaseline.mutate({ projectId })}
            >
              Capture baseline
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand text-xs text-muted">
                  <th className="py-2">Work</th>
                  <th>Start</th>
                  <th>Due</th>
                  <th>Estimate</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {(gantt.data?.items ?? []).map((item) => (
                  <tr key={item.itemId} className="border-b border-sand/70">
                    <td className="py-2">
                      <span
                        className={
                          gantt.data?.criticalItemIds.includes(item.itemId)
                            ? "font-semibold text-ochre"
                            : "font-medium"
                        }
                      >
                        {item.title}
                      </span>
                      {gantt.data?.criticalItemIds.includes(item.itemId) ? (
                        <span className="ml-2 text-xs text-muted">
                          Critical
                        </span>
                      ) : null}
                    </td>
                    <td>{item.startDate ?? "—"}</td>
                    <td>{item.dueAt?.slice(0, 10) ?? "—"}</td>
                    <td>
                      {item.estimatedMinutes
                        ? hours(item.estimatedMinutes)
                        : "—"}
                    </td>
                    <td>
                      {item.scheduleVarianceDays === null
                        ? "—"
                        : `${item.scheduleVarianceDays > 0 ? "+" : ""}${item.scheduleVarianceDays}d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
