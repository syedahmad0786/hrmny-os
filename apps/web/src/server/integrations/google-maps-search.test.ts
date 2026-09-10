import { describe, expect, it, vi } from "vitest";
import type { ComposioLiveClient } from "@hrmny/integrations";
import { searchGoogleMapsDiscovery } from "./google-maps-search";

const clientFor = (body: unknown) => ({ executeTool: vi.fn(async () => body) }) as Pick<ComposioLiveClient, "executeTool">;

describe("Google Maps discovery", () => {
  it("uses the fixed no-auth tool, projects array and single-place shapes, and reports a bounded page", async () => {
    const client = clientFor({
      results: {
        local_results: [{ title: "Acme Dubai", place_id: "p1", address: "Dubai", rating: 4.5, status: "OPEN" }],
        place_results: { title: "Studio Two", place_id: "p2", business_status: "OPERATIONAL" },
        search_metadata: { status: "Success" },
      },
    });
    await expect(searchGoogleMapsDiscovery({ q: "creative agencies", ll: "@25.2048,55.2708,14z" }, { client })).resolves.toEqual({
      results: [
        { title: "Acme Dubai", placeId: "p1", placeUrl: "https://www.google.com/maps/search/?api=1&query=Acme+Dubai&query_place_id=p1", address: "Dubai", rating: 4.5, businessStatus: "open", provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS" },
        { title: "Studio Two", placeId: "p2", placeUrl: "https://www.google.com/maps/search/?api=1&query=Studio+Two&query_place_id=p2", businessStatus: "open", provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS" },
      ], page: { start: 0, limit: 10, partial: false },
    });
    expect(client.executeTool).toHaveBeenCalledWith({ toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS", arguments: { q: "creative agencies", ll: "@25.2048,55.2708,14z" }, version: "latest" });
  });

  it("fails closed for provider errors, omits closed businesses, and labels unrecognized statuses unknown", async () => {
    await expect(searchGoogleMapsDiscovery({ q: "Dubai agencies" }, { client: clientFor({ results: { error: "quota" } }) })).rejects.toThrow("GOOGLE_MAPS_PROVIDER_ERROR");
    await expect(searchGoogleMapsDiscovery({ q: "Dubai agencies" }, { client: clientFor({ results: { search_metadata: { status: "Error" } } }) })).rejects.toThrow("GOOGLE_MAPS_PROVIDER_UNSUCCESSFUL");
    await expect(searchGoogleMapsDiscovery({ q: "Dubai agencies" }, { client: clientFor({}) })).rejects.toThrow("GOOGLE_MAPS_PROVIDER_RESPONSE_INVALID");
    await expect(searchGoogleMapsDiscovery({ q: "Dubai agencies" }, {
      client: clientFor({ results: { local_results: [{ title: "Closed", status: "CLOSED_PERMANENTLY" }, { title: "Unknown", status: "PENDING_REVIEW" }] } }),
    })).resolves.toMatchObject({ results: [{ title: "Unknown", businessStatus: "unknown" }] });
  });

  it("requires a stable location cursor for later pages and reports a next bounded page without fetching it", async () => {
    const executeTool = vi.fn();
    await expect(searchGoogleMapsDiscovery({ q: "Dubai agencies", start: 10 }, { client: { executeTool } })).rejects.toThrow("pagination requires ll");
    await expect(searchGoogleMapsDiscovery({ q: "Dubai agencies", ll: "25.2048,55.2708", start: 10 }, { client: { executeTool } })).rejects.toThrow("pagination requires ll");
    const client = clientFor({ results: { local_results: Array.from({ length: 10 }, (_, index) => ({ title: `Place ${index}` })), serpapi_pagination: { next: "https://serpapi.example/next" } } });
    await expect(searchGoogleMapsDiscovery({ q: "Dubai agencies", ll: "@25.2048,55.2708,12z", start: 0 }, { client })).resolves.toMatchObject({ page: { start: 0, limit: 10, partial: true, nextStart: 20 } });
    expect(client.executeTool).toHaveBeenCalledTimes(1);
  });
});
