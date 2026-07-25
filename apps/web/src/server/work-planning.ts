export type ProgressContribution = { progress: number; weight: number };

export function weightedProgress(
  contributions: readonly ProgressContribution[],
  fallback = 0,
): number {
  const usable = contributions.filter(
    ({ progress, weight }) =>
      Number.isFinite(progress) && Number.isFinite(weight) && weight > 0,
  );
  if (!usable.length) return Math.min(100, Math.max(0, fallback));
  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  const progress = usable.reduce(
    (sum, item) =>
      sum + Math.min(100, Math.max(0, item.progress)) * item.weight,
    0,
  );
  return Math.round((progress / totalWeight) * 100) / 100;
}

export function capacityUtilization(
  allocatedMinutes: number,
  capacityHours: number,
): number {
  if (capacityHours <= 0) return allocatedMinutes > 0 ? 100 : 0;
  return Math.round((allocatedMinutes / (capacityHours * 60)) * 10_000) / 100;
}

export function budgetSummary(
  budgetAmount: number | null,
  hourlyRate: number | null,
  actualMinutes: number,
  remainingEstimatedMinutes: number,
) {
  const rate = hourlyRate ?? 0;
  const actualCost = Math.round((actualMinutes / 60) * rate * 100) / 100;
  const forecastCost =
    Math.round(
      ((actualMinutes + remainingEstimatedMinutes) / 60) * rate * 100,
    ) / 100;
  return {
    actualCost,
    forecastCost,
    variance: budgetAmount === null ? null : budgetAmount - forecastCost,
  };
}

export type WorkReportChartSpec = {
  groupBy:
    | "completion"
    | "assignee"
    | "priority"
    | "section"
    | "task_type"
    | "project"
    | "custom_field";
  metric:
    | "task_count"
    | "estimated_minutes"
    | "actual_minutes"
    | "custom_field_sum"
    | "custom_field_average";
  completion: "all" | "complete" | "incomplete";
  dueFrom: string | null;
  dueTo: string | null;
  includeSubtasks: boolean;
  customFieldId: string | null;
  metricCustomFieldKey?: string | null;
  assigneeEmployeeId?: string | null;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  itemType?: "task" | "milestone" | "approval" | null;
  subtasks?: "all" | "exclude" | "only";
};

export type WorkReportChartRow = {
  itemId: string;
  projectId?: string;
  parentItemId: string | null;
  itemType: "task" | "milestone" | "approval";
  priority: "low" | "medium" | "high" | "urgent" | null;
  assigneeEmployeeId?: string | null;
  assigneeName: string | null;
  sectionName: string | null;
  projectName: string;
  dueAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  customFieldValue?: unknown;
  metricCustomFieldValue?: unknown;
};

function numericCustomFieldValue(value: unknown) {
  const raw =
    value && typeof value === "object" && "number_value" in value
      ? (value as { number_value?: unknown }).number_value
      : value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildWorkReportChart(
  rows: readonly WorkReportChartRow[],
  spec: WorkReportChartSpec,
) {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const subtasks =
      spec.subtasks ?? (spec.includeSubtasks ? "all" : "exclude");
    if (subtasks === "exclude" && row.parentItemId) continue;
    if (subtasks === "only" && !row.parentItemId) continue;
    if (
      spec.assigneeEmployeeId &&
      row.assigneeEmployeeId !== spec.assigneeEmployeeId
    )
      continue;
    if (spec.priority && row.priority !== spec.priority) continue;
    if (spec.itemType && row.itemType !== spec.itemType) continue;
    if (spec.completion === "complete" && !row.completedAt) continue;
    if (spec.completion === "incomplete" && row.completedAt) continue;
    const dueDate = row.dueAt?.slice(0, 10) ?? null;
    if (spec.dueFrom && (!dueDate || dueDate < spec.dueFrom)) continue;
    if (spec.dueTo && (!dueDate || dueDate > spec.dueTo)) continue;
    const label =
      spec.groupBy === "completion"
        ? row.completedAt
          ? "Complete"
          : "Incomplete"
        : spec.groupBy === "assignee"
          ? (row.assigneeName ?? "Unassigned")
          : spec.groupBy === "priority"
            ? row.priority
              ? `${row.priority[0]!.toUpperCase()}${row.priority.slice(1)}`
              : "No priority"
            : spec.groupBy === "section"
              ? (row.sectionName ?? "No section")
              : spec.groupBy === "task_type"
                ? row.itemType === "task"
                  ? "Task"
                  : row.itemType === "milestone"
                    ? "Milestone"
                    : "Approval"
                : spec.groupBy === "project"
                  ? row.projectName
                  : null;
    const customMetric =
      spec.metric === "custom_field_sum" ||
      spec.metric === "custom_field_average";
    const value = customMetric
      ? numericCustomFieldValue(row.metricCustomFieldValue)
      : spec.metric === "task_count"
        ? 1
        : spec.metric === "estimated_minutes"
          ? (row.estimatedMinutes ?? 0)
          : row.actualMinutes;
    if (value === null) continue;
    const labels =
      spec.groupBy !== "custom_field"
        ? [label!]
        : Array.isArray(row.customFieldValue)
          ? [
              ...new Set(
                row.customFieldValue.map((item) => String(item).trim()),
              ),
            ].filter(Boolean)
          : row.customFieldValue === null ||
              row.customFieldValue === undefined ||
              String(row.customFieldValue).trim() === ""
            ? []
            : [String(row.customFieldValue)];
    for (const bucket of labels.length ? labels : ["No value"]) {
      const current = buckets.get(bucket) ?? { sum: 0, count: 0 };
      current.sum += value;
      current.count++;
      buckets.set(bucket, current);
    }
  }
  const data = [...buckets.entries()]
    .map(([label, value]) => ({
      label,
      value:
        spec.metric === "custom_field_average"
          ? value.sum / value.count
          : value.sum,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const totals = [...buckets.values()].reduce(
    (total, bucket) => ({
      sum: total.sum + bucket.sum,
      count: total.count + bucket.count,
    }),
    { sum: 0, count: 0 },
  );
  return {
    data,
    total:
      spec.metric === "custom_field_average" && totals.count
        ? totals.sum / totals.count
        : totals.sum,
  };
}

export function countReportBuckets(labels: readonly string[]) {
  const buckets = new Map<string, number>();
  for (const label of labels) buckets.set(label, (buckets.get(label) ?? 0) + 1);
  const data = [...buckets.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return { data, total: labels.length };
}

type MetadataCustomFieldOperator =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than";

function metadataCustomFieldValues(value: unknown): Array<string | number> {
  if (Array.isArray(value))
    return value.flatMap((item) =>
      typeof item === "string" || typeof item === "number" ? [item] : [],
    );
  return typeof value === "string" || typeof value === "number" ? [value] : [];
}

function matchesMetadataCustomField(
  fields:
    | readonly {
        key: string;
        value: unknown;
        displayValue?: string | null;
      }[]
    | undefined,
  key: string | null | undefined,
  operator: MetadataCustomFieldOperator | null | undefined,
  expected: string | null | undefined,
) {
  if (!key) return true;
  const field = fields?.find((candidate) => candidate.key === key);
  const values = field ? metadataCustomFieldValues(field.value) : [];
  const empty =
    !field ||
    (!values.length && !(field.displayValue ?? "").trim()) ||
    values.every((value) => String(value).trim() === "");
  if (operator === "is_empty") return empty;
  if (operator === "is_not_empty") return !empty;
  if (empty || !operator || expected == null) return false;
  const normalizedExpected = expected.trim().toLocaleLowerCase();
  const normalizedValues = values.map((value) =>
    String(value).trim().toLocaleLowerCase(),
  );
  const equal = normalizedValues.some((value) => value === normalizedExpected);
  const contains = normalizedValues.some((value) =>
    value.includes(normalizedExpected),
  );
  if (operator === "is") return equal;
  if (operator === "is_not") return !equal;
  if (operator === "contains") return contains;
  if (operator === "not_contains") return !contains;
  const actual = values[0];
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const comparison =
    Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)
      ? actualNumber - expectedNumber
      : String(actual).localeCompare(expected);
  return operator === "greater_than" ? comparison > 0 : comparison < 0;
}

export function matchesMetadataReportFilters(
  row: {
    objectId?: string;
    ownerEmployeeId: string | null;
    status?: string | null;
    privacy?: string | null;
    sourcePlatform?: string | null;
    scope?: string | null;
    timePeriod?: string | null;
    parentId?: string | null;
    teamIds?: readonly string[];
    createdAt?: string | null;
    startDate?: string | null;
    dueDate?: string | null;
    customFields?: readonly {
      key: string;
      value: unknown;
      displayValue?: string | null;
    }[];
  },
  filters: {
    objectIds?: readonly string[];
    ownerEmployeeId?: string | null;
    status?: string | null;
    privacy?: string | null;
    sourcePlatform?: string | null;
    scope?: string | null;
    timePeriod?: string | null;
    includeSubgoals?: boolean;
    teamId?: string | null;
    dateField?: "created" | "start" | "due" | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    customFieldKey?: string | null;
    customFieldOperator?: MetadataCustomFieldOperator | null;
    customFieldValue?: string | null;
  },
) {
  const reportDate = filters.dateField
    ? row[
        filters.dateField === "created"
          ? "createdAt"
          : filters.dateField === "start"
            ? "startDate"
            : "dueDate"
      ]?.slice(0, 10)
    : null;
  return (
    (!filters.objectIds?.length ||
      (row.objectId ? filters.objectIds.includes(row.objectId) : false)) &&
    (!filters.ownerEmployeeId ||
      row.ownerEmployeeId === filters.ownerEmployeeId) &&
    (!filters.status || row.status === filters.status) &&
    (!filters.privacy || row.privacy === filters.privacy) &&
    (!filters.sourcePlatform ||
      row.sourcePlatform === filters.sourcePlatform) &&
    (!filters.scope || row.scope === filters.scope) &&
    (!filters.timePeriod || row.timePeriod === filters.timePeriod) &&
    (!filters.teamId || row.teamIds?.includes(filters.teamId)) &&
    (!filters.dateFrom ||
      Boolean(reportDate && reportDate >= filters.dateFrom)) &&
    (!filters.dateTo || Boolean(reportDate && reportDate <= filters.dateTo)) &&
    matchesMetadataCustomField(
      row.customFields,
      filters.customFieldKey,
      filters.customFieldOperator,
      filters.customFieldValue,
    ) &&
    (filters.includeSubgoals !== false || !row.parentId)
  );
}

export function criticalPath(
  items: readonly {
    itemId: string;
    durationMinutes: number;
    dependencies: readonly string[];
  }[],
): string[] {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const memo = new Map<string, { duration: number; path: string[] }>();
  const visiting = new Set<string>();
  const visit = (itemId: string): { duration: number; path: string[] } => {
    const cached = memo.get(itemId);
    if (cached) return cached;
    const item = byId.get(itemId);
    if (!item || visiting.has(itemId)) return { duration: 0, path: [] };
    visiting.add(itemId);
    const prior = item.dependencies
      .map(visit)
      .reduce(
        (longest, candidate) =>
          candidate.duration > longest.duration ? candidate : longest,
        { duration: 0, path: [] as string[] },
      );
    visiting.delete(itemId);
    const result = {
      duration: prior.duration + Math.max(1, item.durationMinutes),
      path: [...prior.path, itemId],
    };
    memo.set(itemId, result);
    return result;
  };
  return items
    .map((item) => visit(item.itemId))
    .reduce(
      (longest, candidate) =>
        candidate.duration > longest.duration ? candidate : longest,
      { duration: 0, path: [] as string[] },
    ).path;
}

export function splitTimerByUtcDay(
  startedAt: string | Date,
  stoppedAt: string | Date,
): { workDate: string; minutes: number }[] {
  const start = new Date(startedAt);
  const stop = new Date(stoppedAt);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(stop.getTime()) ||
    stop <= start
  ) {
    throw new Error("Timer interval is invalid");
  }
  if (stop.getTime() - start.getTime() > 31 * 86_400_000) {
    // ponytail: cap abandoned timers; add admin recovery if 31-day timers become real use.
    throw new Error("Timer cannot run longer than 31 days");
  }

  const result: { workDate: string; minutes: number }[] = [];
  let cursor = start;
  while (cursor < stop) {
    const boundary = new Date(
      Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate() + 1,
      ),
    );
    const end = boundary < stop ? boundary : stop;
    const minutes = Math.max(
      1,
      Math.ceil((end.getTime() - cursor.getTime()) / 60_000),
    );
    result.push({ workDate: cursor.toISOString().slice(0, 10), minutes });
    cursor = end;
  }
  return result;
}
