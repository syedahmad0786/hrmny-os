import type { ComposioLiveClient } from "./live";

export type CanvaDesignSummary = {
  id: string;
  title: string;
  viewUrl?: string;
  editUrl?: string;
};

type CanvaListPayload = {
  items?: Array<{
    id?: unknown;
    title?: unknown;
    urls?: { view_url?: unknown; edit_url?: unknown };
  }>;
};

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
