import { describe, expect, it, vi } from "vitest";
import type { ComposioLiveClient } from "@hrmny/integrations";
import { searchGoogleMapsDiscovery } from "./google-maps-search";

describe("Google Maps discovery", () => {
  it("uses only the fixed no-auth search tool and projects bounded provenance", async () => {
    const executeTool = vi.fn(async () => ({
      results: {
        local_results: [
          {
            title: "Acme Dubai",
            place_id: "p1",
            place_url: "https://maps.google.com/?cid=1",
            address: "Dubai",
            rating: 4.5,
          },
          { title: "Ignored" },
        ],
      },
    }));
    await expect(
      searchGoogleMapsDiscovery(
        { q: "creative agencies", ll: "25.2048,55.2708" },
        { client: { executeTool } as Pick<ComposioLiveClient, "executeTool"> },
      ),
    ).resolves.toEqual([
      {
        title: "Acme Dubai",
        placeId: "p1",
        placeUrl: "https://maps.google.com/?cid=1",
        address: "Dubai",
        rating: 4.5,
        provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS",
      },
      { title: "Ignored", provenance: "composio:COMPOSIO_SEARCH_GOOGLE_MAPS" },
    ]);
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
      arguments: { q: "creative agencies", ll: "25.2048,55.2708" },
      version: "latest",
    });
  });

  it("rejects malformed or out-of-range location bias before provider access", async () => {
    const executeTool = vi.fn();
    await expect(
      searchGoogleMapsDiscovery(
        { q: "Dubai agencies", ll: "javascript:alert(1)" },
        { client: { executeTool } },
      ),
    ).rejects.toThrow("Invalid Google Maps location bias");
    await expect(
      searchGoogleMapsDiscovery(
        { q: "Dubai agencies", ll: "@91,55,12z" },
        { client: { executeTool } },
      ),
    ).rejects.toThrow("Invalid Google Maps location bias");
    expect(executeTool).not.toHaveBeenCalled();
  });
});
