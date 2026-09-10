import { createComposioLive, type ComposioLiveClient } from "@hrmny/integrations";
import { z } from "zod";

const toolSlug = "COMPOSIO_SEARCH_GOOGLE_MAPS";
const pageLimit = 10;
const maximumStart = 20;

function validLocationBias(value: string): boolean {
  const match = /^@?(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d{1,2})z)?$/.exec(value);
  if (!match) return false;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const zoom = match[3] === undefined ? null : Number(match[3]);
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 &&
    (zoom === null || (zoom >= 0 && zoom <= 21));
}

const inputSchema = z.object({
  q: z.string().trim().min(2).max(200),
  ll: z.string().trim().max(100).refine(validLocationBias, "Invalid Google Maps location bias").optional(),
  start: z.number().int().min(0).max(maximumStart).optional(),
}).superRefine((input, ctx) => {
  if ((input.start ?? 0) > 0 && !/^@-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?,\d{1,2}z$/.test(input.ll ?? ""))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Google Maps pagination requires ll in @latitude,longitude,zoomz form" });
});

const resultSchema = z.object({
  title: z.string().min(1).max(300),
  place_id: z.string().min(1).max(500).optional(),
  address: z.string().max(500).optional(),
  rating: z.number().finite().min(0).max(5).optional(),
  status: z.string().max(100).optional(),
  business_status: z.string().max(100).optional(),
}).passthrough();

export type GoogleMapsDiscovery = Readonly<{
  title: string;
  placeId?: string;
  placeUrl?: string;
  address?: string;
  rating?: number;
  businessStatus: "open" | "unknown";
  provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS";
}>;

export type GoogleMapsDiscoveryPage = Readonly<{
  results: readonly GoogleMapsDiscovery[];
  page: Readonly<{ start: number; limit: typeof pageLimit; partial: boolean; nextStart?: number }>;
}>;

function isProviderError(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function resultsFrom(raw: unknown): unknown[] {
  const envelope = z.object({
    results: z.object({
      local_results: z.array(z.unknown()).optional(),
      place_results: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
      error: z.unknown().optional(),
      search_metadata: z.object({ error: z.unknown().optional(), status: z.string().max(100).optional() }).optional(),
      serpapi_pagination: z.object({ next: z.string().url().max(2_000).optional() }).optional(),
    }),
  }).passthrough().safeParse(raw);
  if (!envelope.success) throw new Error("GOOGLE_MAPS_PROVIDER_RESPONSE_INVALID");
  const { results } = envelope.data;
  const metadata = results.search_metadata;
  if (isProviderError(results?.error) || isProviderError(metadata?.error)) throw new Error("GOOGLE_MAPS_PROVIDER_ERROR");
  if (metadata?.status && metadata.status.toLowerCase() !== "success") throw new Error("GOOGLE_MAPS_PROVIDER_UNSUCCESSFUL");
  const places = results?.place_results;
  return [...(results.local_results ?? []), ...(Array.isArray(places) ? places : places ? [places] : [])];
}

function googleMapsUrl(title: string, placeId: string): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", title);
  url.searchParams.set("query_place_id", placeId);
  if (url.protocol !== "https:" || url.hostname !== "www.google.com") throw new Error("GOOGLE_MAPS_URL_INVALID");
  return url.toString();
}

function projectResult(value: unknown): GoogleMapsDiscovery | null {
  const result = resultSchema.safeParse(value);
  if (!result.success) return null;
  const providerStatus = result.data.business_status ?? result.data.status;
  if (providerStatus === "CLOSED_PERMANENTLY" || providerStatus === "TEMPORARILY_CLOSED") return null;
  return {
    title: result.data.title,
    ...(result.data.place_id ? { placeId: result.data.place_id, placeUrl: googleMapsUrl(result.data.title, result.data.place_id) } : {}),
    ...(result.data.address ? { address: result.data.address } : {}),
    ...(result.data.rating !== undefined ? { rating: result.data.rating } : {}),
    businessStatus: providerStatus === "OPEN" || providerStatus === "OPERATIONAL" ? "open" : "unknown",
    provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS",
  };
}

/** No-auth provider discovery only. It neither persists nor enriches results. */
export async function searchGoogleMapsDiscovery(
  input: z.input<typeof inputSchema>,
  deps?: { client?: Pick<ComposioLiveClient, "executeTool"> },
): Promise<GoogleMapsDiscoveryPage> {
  const parsed = inputSchema.parse(input);
  const client = deps?.client ?? createComposioLive({
    apiKey: process.env.COMPOSIO_API_KEY?.trim() || (() => { throw new Error("COMPOSIO_API_KEY_REQUIRED"); })(),
  });
  const raw = await client.executeTool({ toolSlug, arguments: parsed, version: "latest" });
  const providerResults = resultsFrom(raw);
  const envelope = z.object({ results: z.object({ serpapi_pagination: z.object({ next: z.string().url().max(2_000).optional() }).optional() }) }).parse(raw);
  const results = providerResults.flatMap((value) => {
    const projected = projectResult(value);
    return projected ? [projected] : [];
  }).slice(0, pageLimit);
  const start = parsed.start ?? 0;
  const hasProviderNext = Boolean(envelope.results.serpapi_pagination?.next);
  const partial = providerResults.length > pageLimit || hasProviderNext;
  const nextStart = hasProviderNext && parsed.ll && start + maximumStart <= maximumStart ? start + maximumStart : undefined;
  return { results, page: { start, limit: pageLimit, partial, ...(nextStart !== undefined ? { nextStart } : {}) } };
}
