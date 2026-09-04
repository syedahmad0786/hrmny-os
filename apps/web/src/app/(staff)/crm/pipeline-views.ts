export type PipelineRecordView = "active" | "retention" | "archive" | "all";

export type PipelineFilters = {
  search: string;
  source: string;
  temperature: string;
  market: string;
  owner: string;
  records: PipelineRecordView;
};

export type SavedPipelineView = {
  id: string;
  name: string;
  filters: PipelineFilters;
};

export const DEFAULT_PIPELINE_FILTERS: PipelineFilters = {
  search: "",
  source: "all",
  temperature: "all",
  market: "all",
  owner: "all",
  records: "active",
};

const recordViews = new Set<PipelineRecordView>([
  "active",
  "retention",
  "archive",
  "all",
]);

export function parseSavedPipelineViews(
  raw: string | null,
): SavedPipelineView[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SavedPipelineView[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const filters = row.filters as Record<string, unknown> | undefined;
      if (
        typeof row.id !== "string" ||
        typeof row.name !== "string" ||
        !row.name.trim() ||
        !filters ||
        !recordViews.has(filters.records as PipelineRecordView)
      ) {
        return [];
      }
      return [
        {
          id: row.id,
          name: row.name.trim(),
          filters: {
            search: typeof filters.search === "string" ? filters.search : "",
            source: typeof filters.source === "string" ? filters.source : "all",
            temperature:
              typeof filters.temperature === "string"
                ? filters.temperature
                : "all",
            market: typeof filters.market === "string" ? filters.market : "all",
            owner: typeof filters.owner === "string" ? filters.owner : "all",
            records: filters.records as PipelineRecordView,
          },
        },
      ];
    });
  } catch {
    return [];
  }
}

export function retentionLabel(updatedAt: string, now = Date.now()): string {
  const closedAt = Date.parse(updatedAt);
  if (!Number.isFinite(closedAt)) return "Retained in searchable archive";
  const ageDays = Math.max(0, Math.floor((now - closedAt) / 86_400_000));
  return ageDays >= 90
    ? "Retained in searchable archive"
    : `Retention day ${ageDays + 1} of 90`;
}

export function isArchived(updatedAt: string, now = Date.now()): boolean {
  const closedAt = Date.parse(updatedAt);
  if (!Number.isFinite(closedAt)) return false;
  return now - closedAt >= 90 * 86_400_000;
}
