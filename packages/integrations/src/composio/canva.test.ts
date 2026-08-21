import { describe, expect, it, vi } from "vitest";
import {
  downloadUrlsFromCanvaExportJob,
  exportCanvaDesign,
  exportIdFromCanvaPost,
  listCanvaUserDesigns,
} from "./canva";
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

describe("Canva export helpers", () => {
  it("parses export job id and download urls", () => {
    expect(
      exportIdFromCanvaPost({ data: { job: { id: "job_1" } } }),
    ).toBe("job_1");
    expect(
      downloadUrlsFromCanvaExportJob({
        data: {
          job: { status: "success", urls: ["https://cdn.example/a.png"] },
        },
      }),
    ).toEqual({
      status: "success",
      urls: ["https://cdn.example/a.png"],
    });
  });
});

describe("exportCanvaDesign", () => {
  it("posts export then polls until success", async () => {
    const executeTool = vi.fn(async (input: { toolSlug: string }) => {
      if (input.toolSlug === "CANVA_POST_EXPORTS") {
        return { data: { job: { id: "exp_9" } } };
      }
      if (input.toolSlug === "CANVA_GET_DESIGN_EXPORT_JOB_RESULT") {
        return {
          data: {
            job: {
              status: "success",
              urls: ["https://cdn.example/design.png"],
            },
          },
        };
      }
      throw new Error(`unexpected ${input.toolSlug}`);
    }) as unknown as ComposioLiveClient["executeTool"];

    const result = await exportCanvaDesign({
      client: { executeTool },
      connectedAccountId: "conn-canva-1",
      designId: "DAGkg05ZH5w",
      pollDelayMs: 0,
    });

    expect(result).toEqual({
      designId: "DAGkg05ZH5w",
      exportId: "exp_9",
      downloadUrl: "https://cdn.example/design.png",
      format: "png",
    });
    expect(executeTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        toolSlug: "CANVA_POST_EXPORTS",
        arguments: expect.objectContaining({
          design_id: "DAGkg05ZH5w",
          format: { type: "png" },
        }),
      }),
    );
    expect(executeTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        toolSlug: "CANVA_GET_DESIGN_EXPORT_JOB_RESULT",
        arguments: { exportId: "exp_9" },
      }),
    );
  });

  it("fails when job status is failed", async () => {
    const executeTool = vi.fn(async (input: { toolSlug: string }) => {
      if (input.toolSlug === "CANVA_POST_EXPORTS") {
        return { job: { id: "exp_fail" } };
      }
      return { job: { status: "failed", urls: [] } };
    }) as unknown as ComposioLiveClient["executeTool"];

    await expect(
      exportCanvaDesign({
        client: { executeTool },
        connectedAccountId: "conn-1",
        designId: "des_x",
        pollDelayMs: 0,
      }),
    ).rejects.toThrow(/failed/);
  });
});
