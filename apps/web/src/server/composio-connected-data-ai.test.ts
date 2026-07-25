import { describe, expect, it, vi } from "vitest";
import type { ComposioLiveClient } from "@hrmny/integrations";
import { searchComposioConnectedData } from "./composio-connected-data-ai";

describe("Composio AI connected data", () => {
  it("uses only the provider's read-only search tool and bounds prompt context", async () => {
    const executeTool = vi.fn(
      async (_input: {
        connectedAccountId: string;
        toolSlug: string;
        text: string;
      }) => ({
        value: [{ subject: "Acme renewal", bodyPreview: "Review next steps" }],
      }),
    );
    const sources = await searchComposioConnectedData({
      client: { executeTool } as unknown as ComposioLiveClient,
      connectedAccountId: "ca_outlook",
      app: "outlook",
      query: `Acme renewal ${"x".repeat(25_000)}`,
    });

    expect(executeTool).toHaveBeenCalledWith({
      connectedAccountId: "ca_outlook",
      toolSlug: "OUTLOOK_SEARCH_MESSAGES",
      text: expect.stringMatching(/^Search Outlook .*Request: Acme renewal /),
    });
    expect(String(executeTool.mock.calls[0]?.[0]?.text).length).toBeLessThan(
      2_200,
    );
    expect(sources).toEqual([
      expect.objectContaining({
        id: "connected:outlook",
        type: "external_file",
        label: "Outlook search results",
      }),
    ]);
    expect(sources[0]!.content).toContain("Review next steps");
  });
});
