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
    const fetchImpl = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes("/drive/v3/files?"))
        return Response.json({
          files: [
            {
              id: "doc-1",
              name: "Acme onboarding",
              mimeType: "application/vnd.google-apps.document",
              webViewLink: "https://docs.google.com/document/d/doc-1/edit",
            },
          ],
        });
      if (url.includes("/files/doc-1/export"))
        return new Response("Approved onboarding steps");
      if (url.includes("/gmail/v1/users/me/messages?"))
        return Response.json({ messages: [{ id: "mail-1" }] });
      if (url.includes("/gmail/v1/users/me/messages/mail-1?"))
        return Response.json({
          id: "mail-1",
          snippet: "The onboarding review is approved.",
          internalDate: "1784880000000",
          payload: {
            headers: [
              { name: "Subject", value: "Acme onboarding review" },
              { name: "From", value: "client@example.com" },
            ],
          },
        });
      if (url.includes("/calendar/v3/calendars/primary/events?"))
        return Response.json({
          items: [
            {
              id: "event-1",
              summary: "Acme onboarding call",
              start: { dateTime: "2026-07-25T10:00:00Z" },
              end: { dateTime: "2026-07-25T10:30:00Z" },
              htmlLink: "https://calendar.google.com/event?eid=event-1",
            },
          ],
        });
      return Response.json({}, { status: 404 });
    });

    const sources = await searchGoogleWorkspace({
      accessToken: "token",
      query: "Acme onboarding",
      fetchImpl,
    });
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "google:doc-1",
          type: "external_file",
          label: "Acme onboarding",
        }),
        expect.objectContaining({
          id: "google:gmail:mail-1",
          label: "Acme onboarding review",
        }),
        expect.objectContaining({
          id: "google:calendar:event-1",
          label: "Acme onboarding call",
        }),
      ]),
    );
    expect(sources.map((source) => source.content).join("\n")).toContain(
      "Approved onboarding steps",
    );
    expect(sources.map((source) => source.content).join("\n")).toContain(
      "onboarding review is approved",
    );
    expect(
      fetchImpl.mock.calls.some(([request]) =>
        String(request).includes("format=metadata"),
      ),
    ).toBe(true);
    expect(
      fetchImpl.mock.calls.some(([request]) =>
        String(request).includes("format=full"),
      ),
    ).toBe(false);
  });

  it("keeps available sources when one Google service rejects its scope", async () => {
    const sources = await searchGoogleWorkspace({
      accessToken: "token",
      query: "Acme onboarding",
      fetchImpl: vi.fn<typeof fetch>(async (request) => {
        const url = String(request);
        if (url.includes("/drive/v3/files?"))
          return Response.json({ files: [] });
        if (url.includes("/gmail/v1/"))
          return Response.json({}, { status: 403 });
        if (url.includes("/calendar/v3/"))
          return Response.json({
            items: [{ id: "event-2", summary: "Available calendar event" }],
          });
        return Response.json({}, { status: 404 });
      }),
    });

    expect(sources).toEqual([
      expect.objectContaining({ id: "google:calendar:event-2" }),
    ]);
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
