import { describe, expect, it, vi } from "vitest";
import {
  createGoogleWorkspaceFile,
  googleDriveSearchTerms,
  searchGoogleWorkspace,
} from "./google-workspace-ai";

describe("Google Workspace AI connector", () => {
  it("searches bounded terms and exports only supported file content", async () => {
    expect(
      googleDriveSearchTerms("Please find the Acme onboarding document"),
    ).toEqual(["acme", "onboarding"]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          files: [
            {
              id: "doc-1",
              name: "Acme onboarding",
              mimeType: "application/vnd.google-apps.document",
              webViewLink: "https://docs.google.com/document/d/doc-1/edit",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("Approved onboarding steps"));

    const sources = await searchGoogleWorkspace({
      accessToken: "token",
      query: "Acme onboarding",
      fetchImpl,
    });
    expect(sources).toEqual([
      expect.objectContaining({
        id: "google:doc-1",
        type: "external_file",
        label: "Acme onboarding",
      }),
    ]);
    expect(sources[0]!.content).toContain("Approved onboarding steps");
  });

  it("creates an idempotency-tagged document and writes its content", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ files: [] }))
      .mockResolvedValueOnce(
        Response.json({
          id: "doc-2",
          name: "Client plan",
          mimeType: "application/vnd.google-apps.document",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ body: { content: [{ endIndex: 2 }] } }),
      )
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ id: "doc-2" }));

    const file = await createGoogleWorkspaceFile({
      accessToken: "token",
      actionKey: "run:0",
      fileType: "google_doc",
      name: "Client plan",
      content: "Approved plan",
      fetchImpl,
    });
    expect(file.url).toBe("https://docs.google.com/document/d/doc-2/edit");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(String(fetchImpl.mock.calls[1]?.[1]?.body)).toContain(
      "hrmnyActionKey",
    );
  });
});
