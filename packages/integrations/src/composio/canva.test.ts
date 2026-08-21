import { describe, expect, it, vi } from "vitest";
import { listCanvaUserDesigns } from "./canva";
import type { ComposioLiveClient } from "./live";

describe("listCanvaUserDesigns", () => {
  it("maps Composio Canva payload to id/title summaries", async () => {
    const executeTool = vi.fn(async () => ({
      items: [
        {
          id: "des_1",
          title: "Brand kit",
          urls: {
            view_url: "https://canva.com/view/1",
            edit_url: "https://canva.com/edit/1",
          },
        },
        { id: "des_2", title: "  " },
        { id: 99 },
      ],
    })) as unknown as ComposioLiveClient["executeTool"];

    const designs = await listCanvaUserDesigns({
      client: { executeTool },
      connectedAccountId: "conn-canva-1",
    });

    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountId: "conn-canva-1",
        toolSlug: "CANVA_LIST_USER_DESIGNS",
      }),
    );
    expect(designs).toEqual([
      {
        id: "des_1",
        title: "Brand kit",
        viewUrl: "https://canva.com/view/1",
        editUrl: "https://canva.com/edit/1",
      },
      {
        id: "des_2",
        title: "Untitled design",
        viewUrl: undefined,
        editUrl: undefined,
      },
    ]);
  });

  it("fails loud when executeTool throws", async () => {
    const executeTool = vi.fn(async () => {
      throw new Error("canva down");
    }) as unknown as ComposioLiveClient["executeTool"];

    await expect(
      listCanvaUserDesigns({
        client: { executeTool },
        connectedAccountId: "conn-1",
      }),
    ).rejects.toThrow(/canva down/);
  });
});
