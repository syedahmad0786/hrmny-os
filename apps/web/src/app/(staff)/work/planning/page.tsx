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
import {
  countReportBuckets,
  matchesMetadataReportFilters,
} from "@/server/work-planning";

type ReportType = "tasks" | "projects" | "goals" | "portfolios";
type MetadataGroup =
  | "project_health"
  | "project_owner"
  | "project_privacy"
  | "project_source"
  | "goal_status"
  | "goal_owner"
  | "goal_scope"
  | "goal_time_period"
  | "portfolio_health"
  | "portfolio_owner"
  | "portfolio_privacy";
type ReportHealth = "on_track" | "at_risk" | "off_track" | "complete";
type GoalStatus = "on_track" | "at_risk" | "off_track" | "achieved" | "dropped";
type ReportDateField = "created" | "start" | "due";
type ReportDateFilterValue = {
  dateField: ReportDateField;
  dateFrom: string;
  dateTo: string;
};

const metadataGroups: Record<
  Exclude<ReportType, "tasks">,
  readonly { value: MetadataGroup; label: string }[]
> = {
  projects: [
    { value: "project_health", label: "Health" },
    { value: "project_owner", label: "Owner" },
    { value: "project_privacy", label: "Privacy" },
    { value: "project_source", label: "Source" },
  ],
  goals: [
    { value: "goal_status", label: "Status" },
    { value: "goal_owner", label: "Owner" },
    { value: "goal_scope", label: "Scope" },
    { value: "goal_time_period", label: "Time period" },
  ],
  portfolios: [
    { value: "portfolio_health", label: "Health" },
    { value: "portfolio_owner", label: "Owner" },
    { value: "portfolio_privacy", label: "Privacy" },
  ],
};
const healthOptions = [
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "off_track", label: "Off track" },
  { value: "complete", label: "Complete" },
];
const privacyOptions = [
  { value: "organization", label: "Organization" },
  { value: "private", label: "Private" },
];

function ReportFilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted">
      {label}
      <select
        className="rounded border border-sand px-3 py-2 text-sm text-ink"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReportObjectFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: readonly string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <details className="rounded border border-sand bg-white px-3 py-2 text-sm">
      <summary className="cursor-pointer">
        {label}: {value.length ? `${value.length} selected` : "All"}
      </summary>
      <div className="mt-2 grid max-h-48 gap-1 overflow-auto">
        {value.length ? (
          <button
            type="button"
            className="justify-self-start text-xs text-clay underline"
            onClick={() => onChange([])}
          >
            Clear selection
          </button>
        ) : null}
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.includes(option.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, option.value]
                    : value.filter((id) => id !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    </details>
  );
}

function ReportDateFilters({
  fields,
  value,
  onChange,
}: {
  fields: readonly { value: ReportDateField; label: string }[];
  value: ReportDateFilterValue;
  onChange: (value: Partial<ReportDateFilterValue>) => void;
}) {
  const label = fields.find((field) => field.value === value.dateField)?.label;
  return (
    <>
      {fields.length > 1 ? (
        <label className="grid gap-1 text-xs text-muted">
          Date field
          <select
            className="rounded border border-sand px-3 py-2 text-sm text-ink"
            value={value.dateField}
            onChange={(event) =>
              onChange({ dateField: event.target.value as ReportDateField })
            }
          >
            {fields.map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="grid gap-1 text-xs text-muted">
        {label} from
        <input
          className="rounded border border-sand px-3 py-2 text-sm text-ink"
          type="date"
          value={value.dateFrom}
          onChange={(event) => onChange({ dateFrom: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        {label} through
        <input
          className="rounded border border-sand px-3 py-2 text-sm text-ink"
          type="date"
          value={value.dateTo}
          onChange={(event) => onChange({ dateTo: event.target.value })}
        />
      </label>
    </>
  );
}

function readable(value: string) {
  const text = value.replaceAll("_", " ");
  return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

function goalTimePeriod(dueDate: string | null) {
  if (!dueDate) return "No time period";
  const date = new Date(`${dueDate}T00:00:00Z`);
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}

function reportOwners(
  rows: readonly {
    ownerEmployeeId: string | null;
    ownerName?: string | null;
  }[],
) {
  return [
    ...new Map(
      rows.flatMap((row) =>
        row.ownerEmployeeId
          ? [[row.ownerEmployeeId, row.ownerName ?? "Member"] as const]
          : [],
      ),
    ),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function availableMetadataGroups(
  reportType: Exclude<ReportType, "tasks">,
  statusEnabled: boolean,
) {
  return !statusEnabled &&
    (reportType === "projects" || reportType === "portfolios")
    ? metadataGroups[reportType].filter(
        (option) => !option.value.endsWith("_health"),
      )
    : metadataGroups[reportType];
}

function monday() {
  const value = new Date();
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

function hours(minutes: number) {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

const chartColors = ["#C7702E", "#315C4C", "#D9A441", "#547AA5", "#8B5E83"];

function chartValue(metric: string, value: number) {
  if (metric === "task_count") return value.toLocaleString();
  if (["estimated_minutes", "actual_minutes"].includes(metric))
    return hours(value);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function isNumericFieldMetric(metric: string) {
  return metric === "custom_field_sum" || metric === "custom_field_average";
}

function ReportChart({
  data,
  style,
  metric,
  pending = false,
  error,
}: {
  data?: { data: { label: string; value: number }[]; total: number } | null;
  style: "bar" | "donut" | "number";
  metric: string;
  pending?: boolean;
  error?: { message: string } | null;
}) {
  const donutBackground = useMemo(() => {
    if (!data?.total) return "#F0E9DE";
    let offset = 0;
    return `conic-gradient(${data.data
      .map((bucket, index) => {
        const start = offset;
        offset += (bucket.value / data.total) * 100;
        return `${chartColors[index % chartColors.length]} ${start}% ${offset}%`;
      })
      .join(", ")})`;
  }, [data]);
  if (error)
    return <p className="mt-4 text-sm text-red-700">{error.message}</p>;
  if (pending)
    return <p className="mt-4 text-sm text-muted">Updating chart…</p>;
  if (!data?.data.length)
    return (
      <p className="mt-4 text-sm text-muted">No records match these filters.</p>
    );
  if (style === "number")
    return (
      <div className="mt-5 rounded-lg border border-sand bg-white p-5 text-center">
        <p className="text-xs uppercase tracking-wide text-muted">Total</p>
        <p className="mt-1 text-4xl font-semibold">
          {chartValue(metric, data.total)}
        </p>
      </div>
    );
  if (style === "donut")
    return (
      <div className="mt-5 flex flex-wrap items-center gap-6">
        <div
          aria-label="Donut chart"
          className="grid h-40 w-40 place-items-center rounded-full"
          style={{ background: donutBackground }}
        >
          <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center">
            <span className="font-semibold">
              {chartValue(metric, data.total)}
            </span>
          </div>
        </div>
        <div className="grid gap-2 text-sm">
          {data.data.map((bucket, index) => (
            <div key={bucket.label} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: chartColors[index % chartColors.length] }}
              />
              <span className="min-w-32">{bucket.label}</span>
              <strong>{chartValue(metric, bucket.value)}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="mt-5 grid gap-3">
      {data.data.map((bucket) => (
        <div key={bucket.label}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span>{bucket.label}</span>
            <strong>{chartValue(metric, bucket.value)}</strong>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-sand/60">
            <div
              className="h-full rounded-full bg-clay"
              style={{
                width: `${Math.max(
                  2,
                  (bucket.value /
                    Math.max(...data.data.map((item) => item.value), 1)) *
                    100,
                )}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PlanningPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const projects = trpc.work.projects.list.useQuery();
  const [projectId, setProjectId] = useState("");
  const [workloadPortfolioId, setWorkloadPortfolioId] = useState("");
  const [chartPortfolioId, setChartPortfolioId] = useState("");
  const [chartReportType, setChartReportType] = useState<ReportType>("tasks");
  const [metadataGroup, setMetadataGroup] =
    useState<MetadataGroup>("project_health");
  const [projectFilters, setProjectFilters] = useState({
    objectIds: [] as string[],
    ownerEmployeeId: "",
    status: "" as "" | ReportHealth,
    privacy: "" as "" | "organization" | "private",
    sourcePlatform: "" as "" | "native" | "asana",
    teamId: "",
    dateField: "due" as ReportDateField,
    dateFrom: "",
    dateTo: "",
  });
  const [goalFilters, setGoalFilters] = useState({
    objectIds: [] as string[],
    ownerEmployeeId: "",
    status: "" as "" | GoalStatus,
    scope: "" as "" | "company" | "team" | "individual",
    timePeriod: "",
    includeSubgoals: true,
    dateField: "due" as ReportDateField,
    dateFrom: "",
    dateTo: "",
  });
  const [portfolioFilters, setPortfolioFilters] = useState({
    objectIds: [] as string[],
    ownerEmployeeId: "",
    status: "" as "" | ReportHealth,
    privacy: "" as "" | "organization" | "private",
    dateField: "created" as ReportDateField,
    dateFrom: "",
    dateTo: "",
  });
  const employees = trpc.work.members.listEmployees.useQuery({
    projectId: projectId || undefined,
  });
  const [weekStart, setWeekStart] = useState(monday);
  const [chartStyle, setChartStyle] = useState<"bar" | "donut" | "number">(
    "bar",
  );
  const [chartGroupBy, setChartGroupBy] = useState<
    | "completion"
    | "assignee"
    | "priority"
    | "section"
    | "task_type"
    | "project"
    | "custom_field"
  >("completion");
  const [chartMetric, setChartMetric] = useState<
    | "task_count"
    | "estimated_minutes"
    | "actual_minutes"
    | "custom_field_sum"
    | "custom_field_average"
  >("task_count");
  const [chartCompletion, setChartCompletion] = useState<
    "all" | "complete" | "incomplete"
  >("all");
  const [chartDueFrom, setChartDueFrom] = useState("");
  const [chartDueTo, setChartDueTo] = useState("");
  const [chartAssigneeId, setChartAssigneeId] = useState("");
  const [chartPriority, setChartPriority] = useState<
    "" | "low" | "medium" | "high" | "urgent"
  >("");
  const [chartItemType, setChartItemType] = useState<
    "" | "task" | "milestone" | "approval"
  >("");
  const [chartSubtasks, setChartSubtasks] = useState<
    "all" | "exclude" | "only"
  >("all");
  const [chartCustomFieldId, setChartCustomFieldId] = useState("");
  const [chartNumericFieldKey, setChartNumericFieldKey] = useState("");
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
  const customFieldsEnabled = enabled.has("work.custom_fields");
  const teamsEnabled = enabled.has("work.teams");
  const teams = trpc.work.members.listTeams.useQuery(undefined, {
    enabled: chartReportType === "projects" && teamsEnabled,
  });
  const workloadEnabled = enabled.has("work.workload");
  const portfolioWorkloadActive = Boolean(
    workloadPortfolioId && portfoliosEnabled,
  );
  const capacityEnabled = enabled.has("work.capacity_planning");
  const budgetsEnabled = enabled.has("work.budgets");
  const timeEnabled = enabled.has("work.time_tracking");
  const ganttEnabled = enabled.has("work.views.gantt");
  const richTextEnabled = enabled.has("work.rich_text");
  useEffect(() => {
    if (!statusEnabled) {
      if (projectFilters.status)
        setProjectFilters((current) => ({ ...current, status: "" }));
      if (portfolioFilters.status)
        setPortfolioFilters((current) => ({ ...current, status: "" }));
    }
  }, [portfolioFilters.status, projectFilters.status, statusEnabled]);
  useEffect(() => {
    if (!teamsEnabled && projectFilters.teamId)
      setProjectFilters((current) => ({ ...current, teamId: "" }));
  }, [projectFilters.teamId, teamsEnabled]);
  useEffect(() => {
    if (
      (chartItemType === "milestone" && !enabled.has("work.milestones")) ||
      (chartItemType === "approval" && !enabled.has("work.approvals"))
    )
      setChartItemType("");
  }, [chartItemType, enabled]);
  useEffect(() => {
    if (
      !timeEnabled &&
      ["estimated_minutes", "actual_minutes"].includes(chartMetric)
    )
      setChartMetric("task_count");
  }, [chartMetric, timeEnabled]);
  const goals = trpc.work.goals.list.useQuery(undefined, {
    enabled: goalsEnabled,
  });
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const selectedGoal = (goals.data ?? []).find(
    (goal) => goal.goalId === selectedGoalId,
  );
  const goalUpdates = trpc.work.statusUpdates.list.useQuery(
    { targetType: "goal", targetId: selectedGoalId },
    { enabled: Boolean(selectedGoalId && goalsEnabled && statusEnabled) },
  );
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
  const reportingCustomFields = trpc.work.customFields.list.useQuery(
    { projectId },
    {
      enabled: Boolean(
        projectId &&
        chartReportType === "tasks" &&
        !chartPortfolioId &&
        reportingEnabled &&
        customFieldsEnabled,
      ),
    },
  );
  const reportingNumericFields = trpc.work.reporting.numericFields.useQuery(
    chartPortfolioId === "all"
      ? { allProjects: true }
      : chartPortfolioId
        ? { portfolioId: chartPortfolioId }
        : { projectId },
    {
      enabled: Boolean(
        chartReportType === "tasks" &&
        reportingEnabled &&
        (chartPortfolioId === "all"
          ? true
          : chartPortfolioId
            ? portfoliosEnabled
            : projectId && customFieldsEnabled),
      ),
    },
  );
  const numericFieldMetric = isNumericFieldMetric(chartMetric);
  const numericFieldFeatureEnabled = Boolean(
    chartPortfolioId || customFieldsEnabled,
  );
  const numericFieldSelected =
    !numericFieldMetric ||
    (numericFieldFeatureEnabled &&
      !reportingNumericFields.error &&
      Boolean(
        reportingNumericFields.data?.some(
          (field) => field.key === chartNumericFieldKey,
        ),
      ));
  useEffect(() => {
    if (!numericFieldFeatureEnabled || reportingNumericFields.isError) {
      setChartNumericFieldKey("");
      if (numericFieldMetric) setChartMetric("task_count");
      return;
    }
    if (!reportingNumericFields.isSuccess) return;
    const fields = reportingNumericFields.data;
    if (!fields.length) {
      setChartNumericFieldKey("");
      if (numericFieldMetric) setChartMetric("task_count");
      return;
    }
    if (!fields.some((field) => field.key === chartNumericFieldKey))
      setChartNumericFieldKey(fields[0]!.key);
  }, [
    chartNumericFieldKey,
    numericFieldFeatureEnabled,
    numericFieldMetric,
    reportingNumericFields.data,
    reportingNumericFields.isError,
    reportingNumericFields.isSuccess,
  ]);
  useEffect(() => {
    const fields = reportingCustomFields.data ?? [];
    if (chartReportType !== "tasks") return;
    if (!chartPortfolioId && chartGroupBy === "project")
      setChartGroupBy("completion");
    if (chartPortfolioId || !customFieldsEnabled || !fields.length) {
      if (chartGroupBy === "custom_field") setChartGroupBy("completion");
      setChartCustomFieldId("");
      return;
    }
    if (!fields.some((field) => field.customFieldId === chartCustomFieldId))
      setChartCustomFieldId(fields[0]!.customFieldId);
  }, [
    chartCustomFieldId,
    chartGroupBy,
    chartPortfolioId,
    chartReportType,
    customFieldsEnabled,
    reportingCustomFields.data,
  ]);
  useEffect(() => {
    if (chartReportType === "tasks") return;
    const options = availableMetadataGroups(chartReportType, statusEnabled);
    if (!options.some((option) => option.value === metadataGroup))
      setMetadataGroup(options[0]!.value);
    if (chartReportType !== "projects" || chartPortfolioId === "all")
      setChartPortfolioId("");
  }, [chartPortfolioId, chartReportType, metadataGroup, statusEnabled]);
  const taskReportSpec = {
    groupBy: chartGroupBy,
    metric: chartMetric,
    completion: chartCompletion,
    dueFrom: chartDueFrom || null,
    dueTo: chartDueTo || null,
    includeSubtasks: chartSubtasks !== "exclude",
    customFieldId: chartPortfolioId ? null : chartCustomFieldId || null,
    metricCustomFieldKey: numericFieldMetric
      ? chartNumericFieldKey || null
      : null,
    assigneeEmployeeId: chartAssigneeId || null,
    priority: chartPriority || null,
    itemType: chartItemType || null,
    subtasks: chartSubtasks,
  };
  const projectChart = trpc.work.reporting.chart.useQuery(
    {
      projectId,
      spec: taskReportSpec,
    },
    {
      enabled: Boolean(
        projectId &&
        chartReportType === "tasks" &&
        !chartPortfolioId &&
        reportingEnabled &&
        (chartGroupBy !== "custom_field" || chartCustomFieldId) &&
        numericFieldSelected,
      ),
    },
  );
  const portfolioChart = trpc.work.reporting.portfolioChart.useQuery(
    {
      portfolioId: chartPortfolioId,
      spec: taskReportSpec,
    },
    {
      enabled: Boolean(
        chartReportType === "tasks" &&
        chartPortfolioId &&
        chartPortfolioId !== "all" &&
        reportingEnabled &&
        chartGroupBy !== "custom_field" &&
        numericFieldSelected,
      ),
    },
  );
  const allProjectsChart = trpc.work.reporting.allProjectsChart.useQuery(
    { spec: taskReportSpec },
    {
      enabled: Boolean(
        chartReportType === "tasks" &&
        chartPortfolioId === "all" &&
        reportingEnabled &&
        chartGroupBy !== "custom_field" &&
        numericFieldSelected,
      ),
    },
  );
  const taskChart =
    chartPortfolioId === "all"
      ? allProjectsChart
      : chartPortfolioId
        ? portfolioChart
        : projectChart;
  const metadataChart = useMemo(() => {
    if (chartReportType === "tasks") return null;
    if (chartReportType === "projects") {
      const portfolio = (portfolios.data ?? []).find(
        (item) => item.portfolioId === chartPortfolioId,
      );
      const scoped = (projects.data ?? []).filter(
        (project) =>
          (!portfolio || portfolio.projectIds.includes(project.projectId)) &&
          matchesMetadataReportFilters(
            {
              objectId: project.projectId,
              ownerEmployeeId: project.ownerEmployeeId,
              status: project.health,
              privacy: project.privacy,
              sourcePlatform: project.sourcePlatform,
              teamIds: project.teamIds,
              createdAt: project.createdAt,
              startDate: project.startDate,
              dueDate: project.dueDate,
            },
            projectFilters,
          ),
      );
      return countReportBuckets(
        scoped.map((project) =>
          metadataGroup === "project_health"
            ? project.health
              ? readable(project.health)
              : "Health unavailable"
            : metadataGroup === "project_owner"
              ? (project.ownerName ?? "Unassigned")
              : metadataGroup === "project_privacy"
                ? readable(project.privacy)
                : readable(project.sourcePlatform),
        ),
      );
    }
    if (chartReportType === "goals")
      return countReportBuckets(
        (goals.data ?? [])
          .filter((goal) =>
            matchesMetadataReportFilters(
              {
                objectId: goal.goalId,
                ownerEmployeeId: goal.ownerEmployeeId,
                status: goal.status,
                scope: goal.scope,
                timePeriod: goalTimePeriod(goal.dueDate),
                parentId: goal.parentGoalId,
                createdAt: goal.createdAt,
                startDate: goal.startDate,
                dueDate: goal.dueDate,
              },
              goalFilters,
            ),
          )
          .map((goal) => {
            if (metadataGroup === "goal_status") return readable(goal.status);
            if (metadataGroup === "goal_owner")
              return goal.ownerName ?? "Unassigned";
            if (metadataGroup === "goal_scope") return readable(goal.scope);
            return goalTimePeriod(goal.dueDate);
          }),
      );
    return countReportBuckets(
      (portfolios.data ?? [])
        .filter((portfolio) =>
          matchesMetadataReportFilters(
            {
              objectId: portfolio.portfolioId,
              ownerEmployeeId: portfolio.ownerEmployeeId,
              status: portfolio.health,
              privacy: portfolio.privacy,
              createdAt: portfolio.createdAt,
            },
            portfolioFilters,
          ),
        )
        .map((portfolio) =>
          metadataGroup === "portfolio_health"
            ? readable(portfolio.health)
            : metadataGroup === "portfolio_owner"
              ? (portfolio.ownerName ?? "Unassigned")
              : readable(portfolio.privacy),
        ),
    );
  }, [
    chartPortfolioId,
    chartReportType,
    goalFilters,
    goals.data,
    metadataGroup,
    portfolioFilters,
    portfolios.data,
    projectFilters,
    projects.data,
  ]);
  const chartData =
    chartReportType === "tasks" ? taskChart.data : metadataChart;
  const chartError =
    chartReportType === "tasks"
      ? (taskChart.error ??
        (numericFieldMetric ? reportingNumericFields.error : null))
      : null;
  const chartPending =
    chartReportType === "tasks"
      ? taskChart.isPending
      : chartReportType === "projects"
        ? projects.isPending ||
          (Boolean(chartPortfolioId) && portfolios.isPending)
        : chartReportType === "goals"
          ? goals.isPending
          : portfolios.isPending;
  const displayedMetric =
    chartReportType === "tasks" ? chartMetric : "task_count";
  const dashboards = trpc.work.reporting.dashboards.useQuery(undefined, {
    enabled: reportingEnabled,
  });
  const [activeDashboardId, setActiveDashboardId] = useState("");
  const renderedDashboard = trpc.work.reporting.renderDashboard.useQuery(
    { dashboardId: activeDashboardId },
    { enabled: Boolean(activeDashboardId && reportingEnabled) },
  );
  const exportReport = trpc.work.reporting.exportProject.useQuery(
    { projectId },
    { enabled: false },
  );
  const projectWorkload = trpc.work.workload.list.useQuery(
    { projectId, weekStart },
    {
      enabled: Boolean(
        projectId && workloadEnabled && !portfolioWorkloadActive,
      ),
    },
  );
  const portfolioWorkload = trpc.work.workload.portfolio.useQuery(
    { portfolioId: workloadPortfolioId, weekStart },
    {
      enabled: Boolean(portfolioWorkloadActive && workloadEnabled),
    },
  );
  const workload = portfolioWorkloadActive
    ? portfolioWorkload
    : projectWorkload;
  const budget = trpc.work.budgets.summary.useQuery(
    { projectId },
    { enabled: Boolean(projectId && budgetsEnabled) },
  );
  const costRates = trpc.work.budgets.rates.useQuery(
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
  const [goalUpdateTitle, setGoalUpdateTitle] = useState("");
  const [goalUpdateBody, setGoalUpdateBody] = useState("");
  const [goalHealth, setGoalHealth] = useState<
    "on_track" | "at_risk" | "off_track" | "complete"
  >("on_track");
  const createGoal = trpc.work.goals.create.useMutation({
    onSuccess: async () => {
      setGoalName("");
      await utils.work.goals.list.invalidate();
    },
  });
  const linkGoal = trpc.work.goals.link.useMutation({
    onSuccess: () => utils.work.goals.list.invalidate(),
  });
  const createGoalUpdate = trpc.work.statusUpdates.create.useMutation({
    onSuccess: async () => {
      setGoalUpdateTitle("");
      setGoalUpdateBody("");
      await utils.work.statusUpdates.list.invalidate();
    },
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
  const [boardName, setBoardName] = useState("");
  const [boardViewIds, setBoardViewIds] = useState<string[]>([]);
  const saveDashboard = trpc.work.reporting.saveDashboard.useMutation({
    onSuccess: async () => {
      setDashboardName("");
      await utils.work.reporting.dashboards.invalidate();
    },
  });
  const combineDashboards = trpc.work.reporting.combineDashboards.useMutation({
    onSuccess: async (dashboard) => {
      setBoardName("");
      setBoardViewIds([]);
      setActiveDashboardId(dashboard.dashboardId);
      await utils.work.reporting.dashboards.invalidate();
    },
  });
  const deleteDashboard = trpc.work.reporting.deleteDashboard.useMutation({
    onSuccess: (_result, input) => {
      if (activeDashboardId === input.dashboardId) setActiveDashboardId("");
      return utils.work.reporting.dashboards.invalidate();
    },
  });
  const shareDashboard = trpc.work.reporting.shareDashboard.useMutation({
    onSuccess: () => utils.work.reporting.dashboards.invalidate(),
  });
  const loadDashboard = (config: Record<string, unknown>) => {
    const spec = config.spec;
    const reportType = ["projects", "goals", "portfolios"].includes(
      String(config.reportType),
    )
      ? (config.reportType as Exclude<ReportType, "tasks">)
      : "tasks";
    const savedProjectId =
      typeof config.projectId === "string" ? config.projectId : null;
    const savedPortfolioId =
      typeof config.portfolioId === "string" ? config.portfolioId : null;
    const savedAllProjects = config.allProjects === true;
    if (
      !["bar", "donut", "number"].includes(String(config.chartStyle)) ||
      !spec ||
      typeof spec !== "object"
    )
      return;
    const saved = spec as Record<string, unknown>;
    if (reportType !== "tasks") {
      const options = availableMetadataGroups(reportType, statusEnabled);
      if (
        savedProjectId ||
        ((reportType === "goals" || reportType === "portfolios") &&
          savedPortfolioId) ||
        !options.some((option) => option.value === saved.groupBy)
      )
        return;
      setChartReportType(reportType);
      setChartPortfolioId(savedPortfolioId ?? "");
      setChartStyle(config.chartStyle as typeof chartStyle);
      setMetadataGroup(saved.groupBy as MetadataGroup);
      const ownerEmployeeId =
        typeof saved.ownerEmployeeId === "string" ? saved.ownerEmployeeId : "";
      const health = ["on_track", "at_risk", "off_track", "complete"].includes(
        String(saved.status),
      )
        ? (saved.status as ReportHealth)
        : "";
      const privacy = ["organization", "private"].includes(
        String(saved.privacy),
      )
        ? (saved.privacy as "organization" | "private")
        : "";
      const objectIds = Array.isArray(saved.objectIds)
        ? saved.objectIds.filter(
            (objectId): objectId is string => typeof objectId === "string",
          )
        : [];
      const savedDateField = ["created", "start", "due"].includes(
        String(saved.dateField),
      )
        ? (saved.dateField as ReportDateField)
        : reportType === "portfolios"
          ? "created"
          : "due";
      const dateFrom = typeof saved.dateFrom === "string" ? saved.dateFrom : "";
      const dateTo = typeof saved.dateTo === "string" ? saved.dateTo : "";
      if (reportType === "projects") {
        setProjectFilters({
          objectIds,
          ownerEmployeeId,
          status: health,
          privacy,
          sourcePlatform: ["native", "asana"].includes(
            String(saved.sourcePlatform),
          )
            ? (saved.sourcePlatform as "native" | "asana")
            : "",
          teamId: typeof saved.teamId === "string" ? saved.teamId : "",
          dateField: savedDateField,
          dateFrom,
          dateTo,
        });
      } else if (reportType === "goals") {
        setGoalFilters({
          objectIds,
          ownerEmployeeId,
          status: [
            "on_track",
            "at_risk",
            "off_track",
            "achieved",
            "dropped",
          ].includes(String(saved.status))
            ? (saved.status as GoalStatus)
            : "",
          scope: ["company", "team", "individual"].includes(String(saved.scope))
            ? (saved.scope as "company" | "team" | "individual")
            : "",
          timePeriod:
            typeof saved.timePeriod === "string" ? saved.timePeriod : "",
          includeSubgoals: saved.includeSubgoals !== false,
          dateField: savedDateField,
          dateFrom,
          dateTo,
        });
      } else {
        setPortfolioFilters({
          objectIds,
          ownerEmployeeId,
          status: health,
          privacy,
          dateField: "created",
          dateFrom,
          dateTo,
        });
      }
      return;
    }
    if (
      [savedProjectId, savedPortfolioId, savedAllProjects].filter(Boolean)
        .length !== 1 ||
      ![
        "completion",
        "assignee",
        "priority",
        "section",
        "task_type",
        "project",
        "custom_field",
      ].includes(String(saved.groupBy)) ||
      ![
        "task_count",
        "estimated_minutes",
        "actual_minutes",
        "custom_field_sum",
        "custom_field_average",
      ].includes(String(saved.metric)) ||
      (isNumericFieldMetric(String(saved.metric)) &&
        typeof saved.metricCustomFieldKey !== "string") ||
      !["all", "complete", "incomplete"].includes(String(saved.completion))
    )
      return;
    if (
      (savedPortfolioId || savedAllProjects) &&
      saved.groupBy === "custom_field"
    )
      return;
    if (savedProjectId) setProjectId(savedProjectId);
    setChartReportType("tasks");
    setChartPortfolioId(savedAllProjects ? "all" : (savedPortfolioId ?? ""));
    setChartStyle(config.chartStyle as typeof chartStyle);
    setChartGroupBy(saved.groupBy as typeof chartGroupBy);
    setChartMetric(saved.metric as typeof chartMetric);
    setChartCompletion(saved.completion as typeof chartCompletion);
    setChartDueFrom(typeof saved.dueFrom === "string" ? saved.dueFrom : "");
    setChartDueTo(typeof saved.dueTo === "string" ? saved.dueTo : "");
    setChartAssigneeId(
      typeof saved.assigneeEmployeeId === "string"
        ? saved.assigneeEmployeeId
        : "",
    );
    setChartPriority(
      ["low", "medium", "high", "urgent"].includes(String(saved.priority))
        ? (saved.priority as typeof chartPriority)
        : "",
    );
    setChartItemType(
      ["task", "milestone", "approval"].includes(String(saved.itemType))
        ? (saved.itemType as typeof chartItemType)
        : "",
    );
    setChartSubtasks(
      ["all", "exclude", "only"].includes(String(saved.subtasks))
        ? (saved.subtasks as typeof chartSubtasks)
        : saved.includeSubtasks === false
          ? "exclude"
          : "all",
    );
    setChartCustomFieldId(
      typeof saved.customFieldId === "string" ? saved.customFieldId : "",
    );
    setChartNumericFieldKey(
      typeof saved.metricCustomFieldKey === "string"
        ? saved.metricCustomFieldKey
        : "",
    );
  };

  const [budgetAmount, setBudgetAmount] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [rateEmployeeId, setRateEmployeeId] = useState("");
  const [employeeRate, setEmployeeRate] = useState("");
  useEffect(() => {
    if (!rateEmployeeId && employees.data?.[0])
      setRateEmployeeId(employees.data[0].employeeId);
  }, [employees.data, rateEmployeeId]);
  useEffect(() => {
    const rate = (costRates.data ?? []).find(
      (item) => item.employeeId === rateEmployeeId,
    );
    setEmployeeRate(rate?.hourlyCostRate.toString() ?? "");
  }, [costRates.data, rateEmployeeId]);
  const updateBudget = trpc.work.budgets.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.budgets.summary.invalidate(),
        utils.work.reporting.summary.invalidate(),
      ]);
    },
  });
  const setCostRate = trpc.work.budgets.setRate.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.budgets.rates.invalidate(),
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
    onSuccess: async () => {
      await Promise.all([
        utils.work.workload.list.invalidate(),
        utils.work.workload.portfolio.invalidate(),
      ]);
    },
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
    createGoalUpdate.error,
    linkGoal.error,
    createPortfolio.error,
    addPortfolioProject.error,
    createStatus.error,
    deleteDashboard.error,
    shareDashboard.error,
    saveDashboard.error,
    setCostRate.error,
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
                if (chartReportType !== "tasks")
                  saveDashboard.mutate({
                    name: dashboardName,
                    config: {
                      reportType: chartReportType,
                      ...(chartReportType === "projects" && chartPortfolioId
                        ? { portfolioId: chartPortfolioId }
                        : {}),
                      chartStyle,
                      spec: {
                        groupBy: metadataGroup,
                        ...(chartReportType === "projects"
                          ? {
                              objectIds: projectFilters.objectIds,
                              ownerEmployeeId:
                                projectFilters.ownerEmployeeId || null,
                              status: projectFilters.status || null,
                              privacy: projectFilters.privacy || null,
                              sourcePlatform:
                                projectFilters.sourcePlatform || null,
                              teamId: projectFilters.teamId || null,
                              dateField: projectFilters.dateField,
                              dateFrom: projectFilters.dateFrom || null,
                              dateTo: projectFilters.dateTo || null,
                            }
                          : chartReportType === "goals"
                            ? {
                                objectIds: goalFilters.objectIds,
                                ownerEmployeeId:
                                  goalFilters.ownerEmployeeId || null,
                                status: goalFilters.status || null,
                                scope: goalFilters.scope || null,
                                timePeriod: goalFilters.timePeriod || null,
                                includeSubgoals: goalFilters.includeSubgoals,
                                dateField: goalFilters.dateField,
                                dateFrom: goalFilters.dateFrom || null,
                                dateTo: goalFilters.dateTo || null,
                              }
                            : {
                                objectIds: portfolioFilters.objectIds,
                                ownerEmployeeId:
                                  portfolioFilters.ownerEmployeeId || null,
                                status: portfolioFilters.status || null,
                                privacy: portfolioFilters.privacy || null,
                                dateField: portfolioFilters.dateField,
                                dateFrom: portfolioFilters.dateFrom || null,
                                dateTo: portfolioFilters.dateTo || null,
                              }),
                      },
                    },
                  });
                else
                  saveDashboard.mutate({
                    name: dashboardName,
                    config: {
                      reportType: "tasks",
                      ...(chartPortfolioId === "all"
                        ? { allProjects: true }
                        : chartPortfolioId
                          ? { portfolioId: chartPortfolioId }
                          : { projectId }),
                      view: "chart",
                      chartStyle,
                      spec: taskReportSpec,
                    },
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
                disabled={
                  !dashboardName.trim() ||
                  (numericFieldMetric && !numericFieldSelected)
                }
              >
                Save view
              </button>
              {chartReportType === "tasks" && !chartPortfolioId ? (
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
                  Export project
                </button>
              ) : null}
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
          <div className="mt-5 border-t border-sand pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-xs text-muted">
                Report on
                <select
                  className="rounded border border-sand px-3 py-2 text-sm text-ink"
                  value={chartReportType}
                  onChange={(event) =>
                    setChartReportType(event.target.value as ReportType)
                  }
                >
                  <option value="tasks">Tasks</option>
                  <option value="projects">Projects</option>
                  {goalsEnabled ? <option value="goals">Goals</option> : null}
                  {portfoliosEnabled ? (
                    <option value="portfolios">Portfolios</option>
                  ) : null}
                </select>
              </label>
              {chartReportType === "tasks" || chartReportType === "projects" ? (
                <label className="grid gap-1 text-xs text-muted">
                  Chart across
                  <select
                    className="rounded border border-sand px-3 py-2 text-sm text-ink"
                    value={chartPortfolioId}
                    onChange={(event) => {
                      setChartPortfolioId(event.target.value);
                      if (chartReportType === "projects")
                        setProjectFilters((current) => ({
                          ...current,
                          objectIds: [],
                        }));
                    }}
                  >
                    <option value="">
                      {chartReportType === "tasks"
                        ? "This project"
                        : "All visible projects"}
                    </option>
                    {chartReportType === "tasks" ? (
                      <option value="all">All visible projects</option>
                    ) : null}
                    {(portfolios.data ?? []).map((portfolio) => (
                      <option
                        key={portfolio.portfolioId}
                        value={portfolio.portfolioId}
                      >
                        Portfolio: {portfolio.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="grid gap-1 text-xs text-muted">
                Chart style
                <select
                  className="rounded border border-sand px-3 py-2 text-sm text-ink"
                  value={chartStyle}
                  onChange={(event) =>
                    setChartStyle(
                      event.target.value as "bar" | "donut" | "number",
                    )
                  }
                >
                  <option value="bar">Bar</option>
                  <option value="donut">Donut</option>
                  <option value="number">Number</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted">
                Group by
                <select
                  className="rounded border border-sand px-3 py-2 text-sm text-ink"
                  value={
                    chartReportType === "tasks" ? chartGroupBy : metadataGroup
                  }
                  onChange={(event) => {
                    if (chartReportType === "tasks")
                      setChartGroupBy(
                        event.target.value as typeof chartGroupBy,
                      );
                    else setMetadataGroup(event.target.value as MetadataGroup);
                  }}
                >
                  {chartReportType === "tasks" ? (
                    <>
                      <option value="completion">Completion</option>
                      <option value="assignee">Assignee</option>
                      <option value="priority">Priority</option>
                      <option value="section">Section</option>
                      <option value="task_type">Task type</option>
                      {chartPortfolioId ? (
                        <option value="project">Project</option>
                      ) : null}
                      {!chartPortfolioId &&
                      customFieldsEnabled &&
                      (reportingCustomFields.data ?? []).length ? (
                        <option value="custom_field">Custom field</option>
                      ) : null}
                    </>
                  ) : (
                    availableMetadataGroups(chartReportType, statusEnabled).map(
                      (option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ),
                    )
                  )}
                </select>
              </label>
              {chartReportType === "tasks" &&
              chartGroupBy === "custom_field" ? (
                <label className="grid gap-1 text-xs text-muted">
                  Custom field
                  <select
                    className="rounded border border-sand px-3 py-2 text-sm text-ink"
                    value={chartCustomFieldId}
                    onChange={(event) =>
                      setChartCustomFieldId(event.target.value)
                    }
                  >
                    {(reportingCustomFields.data ?? []).map((field) => (
                      <option
                        key={field.customFieldId}
                        value={field.customFieldId}
                      >
                        {field.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {chartReportType === "projects" ? (
                <>
                  <ReportObjectFilter
                    label="Specific projects"
                    value={projectFilters.objectIds}
                    options={(projects.data ?? [])
                      .filter((project) => {
                        if (!chartPortfolioId) return true;
                        return (portfolios.data ?? [])
                          .find(
                            (portfolio) =>
                              portfolio.portfolioId === chartPortfolioId,
                          )
                          ?.projectIds.includes(project.projectId);
                      })
                      .map((project) => ({
                        value: project.projectId,
                        label: project.name,
                      }))}
                    onChange={(objectIds) =>
                      setProjectFilters((current) => ({
                        ...current,
                        objectIds,
                      }))
                    }
                  />
                  <ReportFilterSelect
                    label="Owner"
                    allLabel="All owners"
                    value={projectFilters.ownerEmployeeId}
                    options={reportOwners(projects.data ?? [])}
                    onChange={(ownerEmployeeId) =>
                      setProjectFilters((current) => ({
                        ...current,
                        ownerEmployeeId,
                      }))
                    }
                  />
                  {statusEnabled ? (
                    <ReportFilterSelect
                      label="Health"
                      allLabel="All health"
                      value={projectFilters.status}
                      options={healthOptions}
                      onChange={(status) =>
                        setProjectFilters((current) => ({
                          ...current,
                          status: status as "" | ReportHealth,
                        }))
                      }
                    />
                  ) : null}
                  <ReportFilterSelect
                    label="Privacy"
                    allLabel="All privacy"
                    value={projectFilters.privacy}
                    options={privacyOptions}
                    onChange={(privacy) =>
                      setProjectFilters((current) => ({
                        ...current,
                        privacy: privacy as "" | "organization" | "private",
                      }))
                    }
                  />
                  <ReportFilterSelect
                    label="Source"
                    allLabel="All sources"
                    value={projectFilters.sourcePlatform}
                    options={[
                      { value: "native", label: "hrmny" },
                      { value: "asana", label: "Asana" },
                    ]}
                    onChange={(sourcePlatform) =>
                      setProjectFilters((current) => ({
                        ...current,
                        sourcePlatform: sourcePlatform as
                          "" | "native" | "asana",
                      }))
                    }
                  />
                  {teamsEnabled && (teams.data ?? []).length ? (
                    <ReportFilterSelect
                      label="Team"
                      allLabel="All teams"
                      value={projectFilters.teamId}
                      options={(teams.data ?? []).map((team) => ({
                        value: team.teamId,
                        label: team.name,
                      }))}
                      onChange={(teamId) =>
                        setProjectFilters((current) => ({
                          ...current,
                          teamId,
                        }))
                      }
                    />
                  ) : null}
                  <ReportDateFilters
                    fields={[
                      { value: "created", label: "Created" },
                      { value: "start", label: "Start" },
                      { value: "due", label: "Due" },
                    ]}
                    value={projectFilters}
                    onChange={(value) =>
                      setProjectFilters((current) => ({
                        ...current,
                        ...value,
                      }))
                    }
                  />
                </>
              ) : chartReportType === "goals" ? (
                <>
                  <ReportObjectFilter
                    label="Specific goals"
                    value={goalFilters.objectIds}
                    options={(goals.data ?? []).map((goal) => ({
                      value: goal.goalId,
                      label: goal.name,
                    }))}
                    onChange={(objectIds) =>
                      setGoalFilters((current) => ({
                        ...current,
                        objectIds,
                      }))
                    }
                  />
                  <ReportFilterSelect
                    label="Owner"
                    allLabel="All owners"
                    value={goalFilters.ownerEmployeeId}
                    options={reportOwners(goals.data ?? [])}
                    onChange={(ownerEmployeeId) =>
                      setGoalFilters((current) => ({
                        ...current,
                        ownerEmployeeId,
                      }))
                    }
                  />
                  <ReportFilterSelect
                    label="Status"
                    allLabel="All statuses"
                    value={goalFilters.status}
                    options={[
                      ...healthOptions.slice(0, 3),
                      { value: "achieved", label: "Achieved" },
                      { value: "dropped", label: "Dropped" },
                    ]}
                    onChange={(status) =>
                      setGoalFilters((current) => ({
                        ...current,
                        status: status as "" | GoalStatus,
                      }))
                    }
                  />
                  <ReportFilterSelect
                    label="Scope"
                    allLabel="All goal types"
                    value={goalFilters.scope}
                    options={[
                      { value: "company", label: "Company" },
                      { value: "team", label: "Team" },
                      { value: "individual", label: "Individual" },
                    ]}
                    onChange={(scope) =>
                      setGoalFilters((current) => ({
                        ...current,
                        scope: scope as "" | "company" | "team" | "individual",
                      }))
                    }
                  />
                  <ReportFilterSelect
                    label="Time period"
                    allLabel="All time periods"
                    value={goalFilters.timePeriod}
                    options={[
                      ...new Set(
                        (goals.data ?? [])
                          .map((goal) => goalTimePeriod(goal.dueDate))
                          .filter((period) => period !== "No time period"),
                      ),
                    ]
                      .sort()
                      .map((period) => ({ value: period, label: period }))}
                    onChange={(timePeriod) =>
                      setGoalFilters((current) => ({
                        ...current,
                        timePeriod,
                      }))
                    }
                  />
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={goalFilters.includeSubgoals}
                      onChange={(event) =>
                        setGoalFilters((current) => ({
                          ...current,
                          includeSubgoals: event.target.checked,
                        }))
                      }
                    />
                    Include sub-goals
                  </label>
                  <ReportDateFilters
                    fields={[
                      { value: "created", label: "Created" },
                      { value: "start", label: "Start" },
                      { value: "due", label: "Due" },
                    ]}
                    value={goalFilters}
                    onChange={(value) =>
                      setGoalFilters((current) => ({
                        ...current,
                        ...value,
                      }))
                    }
                  />
                </>
              ) : chartReportType === "portfolios" ? (
                <>
                  <ReportObjectFilter
                    label="Specific portfolios"
                    value={portfolioFilters.objectIds}
                    options={(portfolios.data ?? []).map((portfolio) => ({
                      value: portfolio.portfolioId,
                      label: portfolio.name,
                    }))}
                    onChange={(objectIds) =>
                      setPortfolioFilters((current) => ({
                        ...current,
                        objectIds,
                      }))
                    }
                  />
                  <ReportFilterSelect
                    label="Owner"
                    allLabel="All owners"
                    value={portfolioFilters.ownerEmployeeId}
                    options={reportOwners(portfolios.data ?? [])}
                    onChange={(ownerEmployeeId) =>
                      setPortfolioFilters((current) => ({
                        ...current,
                        ownerEmployeeId,
                      }))
                    }
                  />
                  {statusEnabled ? (
                    <ReportFilterSelect
                      label="Health"
                      allLabel="All health"
                      value={portfolioFilters.status}
                      options={healthOptions}
                      onChange={(status) =>
                        setPortfolioFilters((current) => ({
                          ...current,
                          status: status as "" | ReportHealth,
                        }))
                      }
                    />
                  ) : null}
                  <ReportFilterSelect
                    label="Privacy"
                    allLabel="All privacy"
                    value={portfolioFilters.privacy}
                    options={privacyOptions}
                    onChange={(privacy) =>
                      setPortfolioFilters((current) => ({
                        ...current,
                        privacy: privacy as "" | "organization" | "private",
                      }))
                    }
                  />
                  <ReportDateFilters
                    fields={[{ value: "created", label: "Created" }]}
                    value={portfolioFilters}
                    onChange={(value) =>
                      setPortfolioFilters((current) => ({
                        ...current,
                        ...value,
                      }))
                    }
                  />
                </>
              ) : null}
              {chartReportType === "tasks" ? (
                <>
                  <label className="grid gap-1 text-xs text-muted">
                    Measure
                    <select
                      className="rounded border border-sand px-3 py-2 text-sm text-ink"
                      value={chartMetric}
                      onChange={(event) =>
                        setChartMetric(event.target.value as typeof chartMetric)
                      }
                    >
                      <option value="task_count">Task count</option>
                      {timeEnabled ? (
                        <>
                          <option value="estimated_minutes">
                            Estimated time
                          </option>
                          <option value="actual_minutes">Actual time</option>
                        </>
                      ) : null}
                      {numericFieldFeatureEnabled &&
                      !reportingNumericFields.error &&
                      (reportingNumericFields.data ?? []).length ? (
                        <>
                          <option value="custom_field_sum">
                            Numeric field total
                          </option>
                          <option value="custom_field_average">
                            Numeric field average
                          </option>
                        </>
                      ) : null}
                    </select>
                  </label>
                  {numericFieldMetric ? (
                    <label className="grid gap-1 text-xs text-muted">
                      Numeric field
                      <select
                        className="rounded border border-sand px-3 py-2 text-sm text-ink"
                        value={chartNumericFieldKey}
                        onChange={(event) =>
                          setChartNumericFieldKey(event.target.value)
                        }
                      >
                        {(reportingNumericFields.data ?? []).map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.name}
                            {field.projectCount > 1
                              ? ` · ${field.projectCount} projects`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="grid gap-1 text-xs text-muted">
                    Completion
                    <select
                      className="rounded border border-sand px-3 py-2 text-sm text-ink"
                      value={chartCompletion}
                      onChange={(event) =>
                        setChartCompletion(
                          event.target.value as typeof chartCompletion,
                        )
                      }
                    >
                      <option value="all">All tasks</option>
                      <option value="incomplete">Incomplete</option>
                      <option value="complete">Complete</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs text-muted">
                    Due from
                    <input
                      className="rounded border border-sand px-3 py-2 text-sm text-ink"
                      type="date"
                      value={chartDueFrom}
                      onChange={(event) => setChartDueFrom(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-muted">
                    Due through
                    <input
                      className="rounded border border-sand px-3 py-2 text-sm text-ink"
                      type="date"
                      value={chartDueTo}
                      onChange={(event) => setChartDueTo(event.target.value)}
                    />
                  </label>
                  <ReportFilterSelect
                    label="Assignee"
                    allLabel="All assignees"
                    value={chartAssigneeId}
                    options={(employees.data ?? []).map((employee) => ({
                      value: employee.employeeId,
                      label: employee.displayName,
                    }))}
                    onChange={setChartAssigneeId}
                  />
                  <ReportFilterSelect
                    label="Priority"
                    allLabel="All priorities"
                    value={chartPriority}
                    options={[
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                      { value: "urgent", label: "Urgent" },
                    ]}
                    onChange={(priority) =>
                      setChartPriority(priority as typeof chartPriority)
                    }
                  />
                  <ReportFilterSelect
                    label="Work type"
                    allLabel="All work types"
                    value={chartItemType}
                    options={[
                      { value: "task", label: "Task" },
                      ...(enabled.has("work.milestones")
                        ? [{ value: "milestone", label: "Milestone" }]
                        : []),
                      ...(enabled.has("work.approvals")
                        ? [{ value: "approval", label: "Approval" }]
                        : []),
                    ]}
                    onChange={(itemType) =>
                      setChartItemType(itemType as typeof chartItemType)
                    }
                  />
                  <ReportFilterSelect
                    label="Subtasks"
                    allLabel="All levels"
                    value={chartSubtasks === "all" ? "" : chartSubtasks}
                    options={[
                      { value: "exclude", label: "Exclude subtasks" },
                      { value: "only", label: "Only subtasks" },
                    ]}
                    onChange={(subtasks) =>
                      setChartSubtasks(
                        subtasks ? (subtasks as "exclude" | "only") : "all",
                      )
                    }
                  />
                </>
              ) : null}
            </div>
            <ReportChart
              data={chartData}
              style={chartStyle}
              metric={displayedMetric}
              pending={chartPending}
              error={chartError}
            />
          </div>
          {(dashboards.data ?? []).length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Saved views:</span>
              {(dashboards.data ?? []).map((item) => (
                <div
                  key={item.dashboardId}
                  className="overflow-hidden rounded border border-sand bg-white"
                >
                  <div className="inline-flex items-center">
                    <button
                      type="button"
                      className="px-2 py-1"
                      onClick={() => {
                        if (Array.isArray(item.config.widgets))
                          setActiveDashboardId(item.dashboardId);
                        else {
                          setActiveDashboardId("");
                          loadDashboard(item.config);
                        }
                      }}
                    >
                      {Array.isArray(item.config.widgets) ? "Dashboard: " : ""}
                      {item.name}
                    </button>
                    {item.currentAccess === "viewer" ? (
                      <span className="border-l border-sand px-2 py-1 text-muted">
                        Shared
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        className="border-l border-sand px-2 py-1 text-muted"
                        onClick={() =>
                          deleteDashboard.mutate({
                            dashboardId: item.dashboardId,
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {item.currentAccess === "admin" ? (
                    <details className="border-t border-sand px-2 py-1">
                      <summary className="cursor-pointer text-muted">
                        Share
                      </summary>
                      <div className="mt-2 grid min-w-56 gap-2 pb-1">
                        <label className="grid gap-1">
                          Who can open this view?
                          <select
                            className="rounded border border-sand bg-white px-2 py-1"
                            value={item.visibility}
                            disabled={shareDashboard.isPending}
                            onChange={(event) =>
                              shareDashboard.mutate({
                                dashboardId: item.dashboardId,
                                visibility: event.target.value as
                                  "private" | "organization",
                                viewerEmployeeIds: item.viewerEmployeeIds,
                              })
                            }
                          >
                            <option value="private">
                              Only selected people
                            </option>
                            <option value="organization">
                              Everyone who has access
                            </option>
                          </select>
                        </label>
                        {item.visibility === "private" ? (
                          <fieldset className="grid gap-1">
                            <legend className="text-muted">People</legend>
                            {(employees.data ?? [])
                              .filter(
                                (employee) =>
                                  employee.employeeId !== item.ownerEmployeeId,
                              )
                              .map((employee) => (
                                <label
                                  key={employee.employeeId}
                                  className="flex items-center gap-2"
                                >
                                  <input
                                    type="checkbox"
                                    checked={item.viewerEmployeeIds.includes(
                                      employee.employeeId,
                                    )}
                                    disabled={shareDashboard.isPending}
                                    onChange={(event) =>
                                      shareDashboard.mutate({
                                        dashboardId: item.dashboardId,
                                        visibility: item.visibility,
                                        viewerEmployeeIds: event.target.checked
                                          ? [
                                              ...item.viewerEmployeeIds,
                                              employee.employeeId,
                                            ]
                                          : item.viewerEmployeeIds.filter(
                                              (id) =>
                                                id !== employee.employeeId,
                                            ),
                                      })
                                    }
                                  />
                                  {employee.displayName}
                                </label>
                              ))}
                          </fieldset>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {(dashboards.data ?? []).filter(
            (dashboard) => !Array.isArray(dashboard.config.widgets),
          ).length >= 2 ? (
            <details className="mt-4 rounded-lg border border-sand bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                Build a multi-widget dashboard
              </summary>
              <form
                className="mt-3 grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  combineDashboards.mutate({
                    name: boardName,
                    dashboardIds: boardViewIds,
                  });
                }}
              >
                <input
                  aria-label="Dashboard name"
                  className="rounded border border-sand px-3 py-2 text-sm"
                  placeholder="Dashboard name"
                  value={boardName}
                  onChange={(event) => setBoardName(event.target.value)}
                />
                <fieldset className="grid gap-1 sm:grid-cols-2">
                  <legend className="mb-1 text-xs text-muted">
                    Choose two or more saved views
                  </legend>
                  {(dashboards.data ?? [])
                    .filter(
                      (dashboard) => !Array.isArray(dashboard.config.widgets),
                    )
                    .map((dashboard) => (
                      <label
                        key={dashboard.dashboardId}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={boardViewIds.includes(dashboard.dashboardId)}
                          onChange={(event) =>
                            setBoardViewIds((current) =>
                              event.target.checked
                                ? [...current, dashboard.dashboardId]
                                : current.filter(
                                    (id) => id !== dashboard.dashboardId,
                                  ),
                            )
                          }
                        />
                        {dashboard.name}
                      </label>
                    ))}
                </fieldset>
                {combineDashboards.error ? (
                  <p className="text-sm text-red-700">
                    {combineDashboards.error.message}
                  </p>
                ) : null}
                <button
                  className="justify-self-start rounded bg-ink px-3 py-2 text-sm text-white"
                  disabled={
                    !boardName.trim() ||
                    boardViewIds.length < 2 ||
                    combineDashboards.isPending
                  }
                >
                  Save dashboard
                </button>
              </form>
            </details>
          ) : null}
          {activeDashboardId ? (
            <div className="mt-5 rounded-xl border border-sand bg-cream/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-xl">
                  {renderedDashboard.data?.name ?? "Dashboard"}
                </h3>
                <button
                  type="button"
                  className="rounded border border-sand bg-white px-3 py-1.5 text-sm"
                  onClick={() => setActiveDashboardId("")}
                >
                  Close
                </button>
              </div>
              {renderedDashboard.error ? (
                <p className="mt-3 text-sm text-red-700">
                  {renderedDashboard.error.message}
                </p>
              ) : renderedDashboard.isPending ? (
                <p className="mt-3 text-sm text-muted">Loading dashboard…</p>
              ) : (
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  {(renderedDashboard.data?.widgets ?? []).map(
                    (widget, index) => (
                      <article
                        key={`${widget.title}:${index}`}
                        className="rounded-lg border border-sand bg-white p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="font-semibold">{widget.title}</h4>
                          <span className="text-xs capitalize text-muted">
                            {widget.reportType}
                          </span>
                        </div>
                        <ReportChart
                          data={widget.chart}
                          style={widget.chartStyle}
                          metric={widget.metric}
                        />
                      </article>
                    ),
                  )}
                </div>
              )}
            </div>
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
                <div className="mt-3 flex flex-wrap gap-2">
                  {projectId ? (
                    <button
                      type="button"
                      className="rounded border border-sand px-3 py-1.5 text-xs"
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
                  {statusEnabled ? (
                    <button
                      type="button"
                      className="rounded border border-sand px-3 py-1.5 text-xs"
                      onClick={() =>
                        setSelectedGoalId(
                          selectedGoalId === goal.goalId ? "" : goal.goalId,
                        )
                      }
                    >
                      {selectedGoalId === goal.goalId
                        ? "Hide history"
                        : "Progress history"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {selectedGoal && statusEnabled ? (
            <div className="mt-4 rounded-lg border border-sand bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{selectedGoal.name} history</h3>
                  <p className="text-xs text-muted">
                    Dated progress updates are kept here.
                  </p>
                </div>
                <strong>{selectedGoal.progress}% now</strong>
              </div>
              <form
                className="mt-3 grid gap-2 md:grid-cols-[1fr_2fr_auto_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  createGoalUpdate.mutate({
                    targetType: "goal",
                    targetId: selectedGoal.goalId,
                    health: goalHealth,
                    progress: selectedGoal.progress,
                    title: goalUpdateTitle,
                    body: goalUpdateBody,
                  });
                }}
              >
                <input
                  aria-label="Goal update title"
                  className="rounded border border-sand px-3 py-2"
                  placeholder="Update title"
                  value={goalUpdateTitle}
                  onChange={(event) => setGoalUpdateTitle(event.target.value)}
                />
                <textarea
                  aria-label="Goal update details"
                  className="min-h-10 rounded border border-sand px-3 py-2"
                  maxLength={50_000}
                  placeholder="What changed?"
                  value={goalUpdateBody}
                  onChange={(event) => setGoalUpdateBody(event.target.value)}
                />
                <select
                  aria-label="Goal health"
                  className="rounded border border-sand px-3 py-2"
                  value={goalHealth}
                  onChange={(event) =>
                    setGoalHealth(event.target.value as typeof goalHealth)
                  }
                >
                  <option value="on_track">On track</option>
                  <option value="at_risk">At risk</option>
                  <option value="off_track">Off track</option>
                  <option value="complete">Complete</option>
                </select>
                <button
                  className="rounded bg-ink px-4 py-2 text-white"
                  disabled={
                    !goalUpdateTitle.trim() || createGoalUpdate.isPending
                  }
                >
                  Add update
                </button>
              </form>
              <div className="mt-4 space-y-2">
                {goalUpdates.isPending ? (
                  <p className="text-sm text-muted">Loading history…</p>
                ) : !(goalUpdates.data ?? []).length ? (
                  <p className="text-sm text-muted">No updates yet.</p>
                ) : (
                  (goalUpdates.data ?? []).map((update) => (
                    <article
                      key={update.statusUpdateId}
                      className="rounded border border-sand p-3"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <h4 className="font-medium">{update.title}</h4>
                          <p className="text-xs text-muted">
                            {new Date(update.createdAt).toLocaleDateString()} ·{" "}
                            {update.health.replaceAll("_", " ")}
                          </p>
                        </div>
                        {update.progress === null ? null : (
                          <strong>{update.progress}%</strong>
                        )}
                      </div>
                      {update.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                          {update.body}
                        </p>
                      ) : null}
                      {update.progress === null ? null : (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand">
                          <div
                            className="h-full bg-ochre"
                            style={{ width: `${update.progress}%` }}
                          />
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </div>
          ) : null}
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
              aria-label="Project default hourly cost rate"
              className="rounded border border-sand px-3 py-2"
              type="number"
              min="0"
              placeholder={
                budget.data.hourlyCostRate?.toString() ?? "Default hourly rate"
              }
              value={hourlyRate}
              onChange={(event) => setHourlyRate(event.target.value)}
            />
            <button className="rounded bg-ink px-4 py-2 text-white">
              Save budget
            </button>
          </form>
          <div className="mt-4 border-t border-sand pt-4">
            <h3 className="font-semibold">Person cost rates</h3>
            <p className="text-xs text-muted">
              Overrides use the project default when left blank.
            </p>
            <form
              className="mt-2 grid gap-2 md:grid-cols-[2fr_1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                if (!rateEmployeeId) return;
                setCostRate.mutate({
                  projectId,
                  employeeId: rateEmployeeId,
                  hourlyCostRate: employeeRate ? Number(employeeRate) : null,
                });
              }}
            >
              <select
                aria-label="Person"
                className="rounded border border-sand px-3 py-2"
                value={rateEmployeeId}
                onChange={(event) => setRateEmployeeId(event.target.value)}
              >
                {(employees.data ?? []).map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayName}
                  </option>
                ))}
              </select>
              <input
                aria-label="Person hourly cost rate"
                className="rounded border border-sand px-3 py-2"
                type="number"
                min="0"
                placeholder="Use project default"
                value={employeeRate}
                onChange={(event) => setEmployeeRate(event.target.value)}
              />
              <button
                className="rounded border border-sand px-4 py-2"
                disabled={!rateEmployeeId || setCostRate.isPending}
              >
                Save rate
              </button>
            </form>
            {(costRates.data ?? []).length ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {(costRates.data ?? []).map((rate) => (
                  <span
                    key={rate.employeeId}
                    className="rounded-full border border-sand px-3 py-1"
                  >
                    {rate.employeeName}: {budget.data.budgetCurrency}{" "}
                    {rate.hourlyCostRate.toLocaleString()}/hour
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {workloadEnabled ? (
        <section className="rounded-xl border border-sand bg-white/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Workload</h2>
              <p className="text-sm text-muted">
                {portfolioWorkloadActive
                  ? "Capacity across every visible project in this portfolio."
                  : "Planned work compared with weekly capacity."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {portfoliosEnabled && (portfolios.data ?? []).length ? (
                <select
                  aria-label="Workload scope"
                  className="rounded border border-sand px-3 py-2"
                  value={workloadPortfolioId}
                  onChange={(event) =>
                    setWorkloadPortfolioId(event.target.value)
                  }
                >
                  <option value="">Selected project</option>
                  {(portfolios.data ?? []).map((portfolio) => (
                    <option
                      key={portfolio.portfolioId}
                      value={portfolio.portfolioId}
                    >
                      {portfolio.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                aria-label="Week starting"
                className="rounded border border-sand px-3 py-2"
                type="date"
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value)}
              />
            </div>
          </div>
          {capacityEnabled && !portfolioWorkloadActive ? (
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
