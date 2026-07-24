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
    | "custom_field";
  metric: "task_count" | "estimated_minutes" | "actual_minutes";
  completion: "all" | "complete" | "incomplete";
  dueFrom: string | null;
  dueTo: string | null;
  includeSubtasks: boolean;
  customFieldId: string | null;
};

export type WorkReportChartRow = {
  itemId: string;
  parentItemId: string | null;
  itemType: "task" | "milestone" | "approval";
  priority: "low" | "medium" | "high" | "urgent" | null;
  assigneeName: string | null;
  sectionName: string | null;
  dueAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  customFieldValue?: unknown;
};

export function buildWorkReportChart(
  rows: readonly WorkReportChartRow[],
  spec: WorkReportChartSpec,
) {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    if (!spec.includeSubtasks && row.parentItemId) continue;
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
                : null;
    const value =
      spec.metric === "task_count"
        ? 1
        : spec.metric === "estimated_minutes"
          ? (row.estimatedMinutes ?? 0)
          : row.actualMinutes;
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
    for (const bucket of labels.length ? labels : ["No value"])
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + value);
  }
  const data = [...buckets.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return {
    data,
    total: data.reduce((sum, bucket) => sum + bucket.value, 0),
  };
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
