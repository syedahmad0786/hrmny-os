import type { ComposioLiveClient } from "./live";

export type CanvaDesignSummary = {
  id: string;
  title: string;
  viewUrl?: string;
  editUrl?: string;
};

export type CanvaExportResult = {
  designId: string;
  exportId: string;
  downloadUrl: string;
  format: "png" | "jpg";
};

type CanvaListPayload = {
  items?: Array<{
    id?: unknown;
    title?: unknown;
    urls?: { view_url?: unknown; edit_url?: unknown };
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Unwrap nested Composio `data` / `job` envelopes. */
export function unwrapCanvaJob(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.data) ?? root;
  const job = asRecord(data.job) ?? data;
  return job;
}

export function exportIdFromCanvaPost(payload: unknown): string | null {
  const job = unwrapCanvaJob(payload);
  const id = job?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function downloadUrlsFromCanvaExportJob(
  payload: unknown,
): { status: string; urls: string[] } | null {
  const job = unwrapCanvaJob(payload);
  if (!job) return null;
  const status =
    typeof job.status === "string" ? job.status.toLowerCase() : "unknown";
  const rawUrls = job.urls;
  const urls = Array.isArray(rawUrls)
    ? rawUrls.filter((u): u is string => typeof u === "string" && Boolean(u.trim()))
    : [];
  return { status, urls };
}

/**
 * List the connected user's Canva designs via Composio
 * (`CANVA_LIST_USER_DESIGNS`). Fail-loud on tool errors.
 */
export async function listCanvaUserDesigns(input: {
  client: Pick<ComposioLiveClient, "executeTool">;
  connectedAccountId: string;
  query?: string;
  limit?: number;
}): Promise<CanvaDesignSummary[]> {
  const raw = await input.client.executeTool<CanvaListPayload | { data?: CanvaListPayload }>({
    connectedAccountId: input.connectedAccountId,
    toolSlug: "CANVA_LIST_USER_DESIGNS",
    arguments: {
      ownership: "any",
      sort_by: "modified_descending",
      ...(input.query?.trim() ? { query: input.query.trim() } : {}),
    },
  });

  const payload: CanvaListPayload =
    raw && typeof raw === "object" && "items" in raw
      ? (raw as CanvaListPayload)
      : raw &&
          typeof raw === "object" &&
          "data" in raw &&
          raw.data &&
          typeof raw.data === "object"
        ? (raw.data as CanvaListPayload)
        : {};

  const items = Array.isArray(payload.items) ? payload.items : [];
  const limit = Math.max(1, Math.min(input.limit ?? 24, 50));
  const designs: CanvaDesignSummary[] = [];
  for (const item of items) {
    if (typeof item?.id !== "string" || !item.id.trim()) continue;
    const title =
      typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : "Untitled design";
    designs.push({
      id: item.id,
      title,
      viewUrl:
        typeof item.urls?.view_url === "string"
          ? item.urls.view_url
          : undefined,
      editUrl:
        typeof item.urls?.edit_url === "string" ? item.urls.edit_url : undefined,
    });
    if (designs.length >= limit) break;
  }
  return designs;
}

/**
 * Export a Canva design to PNG/JPG via Composio async job:
 * `CANVA_POST_EXPORTS` → poll `CANVA_GET_DESIGN_EXPORT_JOB_RESULT`.
 */
export async function exportCanvaDesign(input: {
  client: Pick<ComposioLiveClient, "executeTool">;
  connectedAccountId: string;
  designId: string;
  format?: "png" | "jpg";
  /** Max poll attempts (default 12). */
  maxAttempts?: number;
  /** Delay between polls in ms (default 1500). Inject 0 in unit tests. */
  pollDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CanvaExportResult> {
  const designId = input.designId.trim();
  if (!designId) throw new Error("designId is required");
  const format = input.format ?? "png";
  const formatArg =
    format === "jpg"
      ? { type: "jpg" as const, quality: 85 }
      : { type: "png" as const };

  const started = await input.client.executeTool({
    connectedAccountId: input.connectedAccountId,
    toolSlug: "CANVA_POST_EXPORTS",
    arguments: {
      design_id: designId,
      format: formatArg,
    },
  });
  const exportId = exportIdFromCanvaPost(started);
  if (!exportId) {
    throw new Error("CANVA_POST_EXPORTS did not return an export job id");
  }

  const maxAttempts = Math.max(1, input.maxAttempts ?? 12);
  const delayMs = Math.max(0, input.pollDelayMs ?? 1500);
  const sleep =
    input.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0 && delayMs > 0) await sleep(delayMs);
    const polled = await input.client.executeTool({
      connectedAccountId: input.connectedAccountId,
      toolSlug: "CANVA_GET_DESIGN_EXPORT_JOB_RESULT",
      arguments: { exportId },
    });
    const result = downloadUrlsFromCanvaExportJob(polled);
    if (!result) continue;
    if (result.status === "failed") {
      throw new Error(`Canva export job ${exportId} failed`);
    }
    if (
      (result.status === "success" || result.status === "completed") &&
      result.urls[0]
    ) {
      return {
        designId,
        exportId,
        downloadUrl: result.urls[0],
        format,
      };
    }
  }
  throw new Error(
    `Canva export job ${exportId} did not complete within ${maxAttempts} polls`,
  );
}
