import {
  createComposioLive,
  type ComposioLiveClient,
} from "@hrmny/integrations";
import { z } from "zod";

const toolSlug = "COMPOSIO_SEARCH_GOOGLE_MAPS";
function validLocationBias(value: string): boolean {
  const match =
    /^@?(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d{1,2})z)?$/.exec(
      value,
    );
  if (!match) return false;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const zoom = match[3] === undefined ? null : Number(match[3]);
  return (
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    (zoom === null || (zoom >= 0 && zoom <= 21))
  );
}
const inputSchema = z.object({
  q: z.string().trim().min(2).max(200),
  ll: z
    .string()
    .trim()
    .max(100)
    .refine(validLocationBias, "Invalid Google Maps location bias")
    .optional(),
  start: z.number().int().min(0).max(20).optional(),
});
const resultSchema = z
  .object({
    title: z.string().min(1).max(300),
    place_id: z.string().min(1).max(500).optional(),
    place_url: z.string().url().max(2_000).optional(),
    address: z.string().max(500).optional(),
    rating: z.number().finite().min(0).max(5).optional(),
  })
  .passthrough();

export type GoogleMapsDiscovery = Readonly<{
  title: string;
  placeId?: string;
  placeUrl?: string;
  address?: string;
  rating?: number;
  provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS";
}>;

function resultsFrom(raw: unknown): unknown[] {
  const data = z
    .object({
      results: z
        .object({
          local_results: z.array(z.unknown()).optional(),
          place_results: z.array(z.unknown()).optional(),
        })
        .optional(),
    })
    .passthrough()
    .safeParse(raw);
  return data.success
    ? [
        ...(data.data.results?.local_results ?? []),
        ...(data.data.results?.place_results ?? []),
      ]
    : [];
}

/** No-auth provider discovery only. It neither persists nor enriches results. */
export async function searchGoogleMapsDiscovery(
  input: z.input<typeof inputSchema>,
  deps?: {
    client?: Pick<ComposioLiveClient, "executeTool">;
  },
): Promise<GoogleMapsDiscovery[]> {
  const parsed = inputSchema.parse(input);
  const client =
    deps?.client ??
    createComposioLive({
      apiKey:
        process.env.COMPOSIO_API_KEY?.trim() ||
        (() => {
          throw new Error("COMPOSIO_API_KEY_REQUIRED");
        })(),
    });
  const raw = await client.executeTool({
    toolSlug,
    arguments: parsed,
    version: "latest",
  });
  return resultsFrom(raw)
    .flatMap((value) => {
      const result = resultSchema.safeParse(value);
      return result.success
        ? [
            {
              title: result.data.title,
              ...(result.data.place_id
                ? { placeId: result.data.place_id }
                : {}),
              ...(result.data.place_url
                ? { placeUrl: result.data.place_url }
                : {}),
              ...(result.data.address ? { address: result.data.address } : {}),
              ...(result.data.rating !== undefined
                ? { rating: result.data.rating }
                : {}),
              provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS" as const,
            },
          ]
        : [];
    })
    .slice(0, 10);
}
