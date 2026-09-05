import { createHash } from "node:crypto";
import { z } from "zod";

const driveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  modifiedTime: z.string().optional(),
  webViewLink: z.string().url().optional(),
  description: z.string().optional(),
  appProperties: z.record(z.string()).optional(),
});

const driveFileListSchema = z.object({ files: z.array(driveFileSchema) });

const gmailMessageListSchema = z.object({
  messages: z
    .array(z.object({ id: z.string().min(1), threadId: z.string().optional() }))
    .optional(),
});

const gmailMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().optional(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  payload: z
    .object({
      headers: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional(),
    })
    .optional(),
});

const calendarEventListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        htmlLink: z.string().url().optional(),
        start: z
          .object({
            date: z.string().optional(),
            dateTime: z.string().optional(),
          })
          .optional(),
        end: z
          .object({
            date: z.string().optional(),
            dateTime: z.string().optional(),
          })
          .optional(),
        attendees: z
          .array(
            z.object({
              email: z.string().optional(),
              displayName: z.string().optional(),
              responseStatus: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

const ignoredTerms = new Set([
  "about",
  "after",
  "before",
  "could",
  "create",
  "document",
  "drive",
  "file",
  "find",
  "from",
  "google",
  "into",
  "please",
  "sheet",
  "should",
  "that",
  "the",
  "their",
  "this",
  "using",
  "with",
]);

export function googleDriveSearchTerms(query: string) {
  return [
    ...new Set(
      (
        query
          .normalize("NFKC")
          .toLowerCase()
          .match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []
      ).filter((term) => !ignoredTerms.has(term)),
    ),
  ].slice(0, 6);
}

function escapeDriveQuery(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function googleRequest(
  url: string,
  accessToken: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(20000),
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(`Google Workspace request failed (${response.status})`);
  return response;
}

async function fileText(
  file: z.infer<typeof driveFileSchema>,
  accessToken: string,
  fetchImpl: typeof fetch,
) {
  const exportMime =
    file.mimeType === "application/vnd.google-apps.document"
      ? "text/plain"
      : file.mimeType === "application/vnd.google-apps.spreadsheet"
        ? "text/csv"
        : null;
  if (!exportMime) return "";
  const response = await googleRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportMime)}`,
    accessToken,
    {},
    fetchImpl,
  );
  return (await response.text()).slice(0, 8_000);
}

async function searchGoogleDrive(input: {
  accessToken: string;
  query: string;
  fetchImpl: typeof fetch;
}) {
  const terms = googleDriveSearchTerms(input.query);
  if (!terms.length) return [];
  const q = `trashed = false and (${terms
    .map(
      (term) =>
        `(name contains '${escapeDriveQuery(term)}' or fullText contains '${escapeDriveQuery(term)}')`,
    )
    .join(" or ")})`;
  const params = new URLSearchParams({
    q,
    pageSize: "5",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,description)",
  });
  const response = await googleRequest(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    input.accessToken,
    {},
    input.fetchImpl,
  );
  const files = driveFileListSchema.parse(await response.json()).files;
  const sources = [];
  for (const file of files) {
    const text = await fileText(file, input.accessToken, input.fetchImpl).catch(
      () => "",
    );
    sources.push({
      id: `google:${file.id}`,
      type: "external_file" as const,
      label: file.name,
      content: JSON.stringify({
        provider: "Google Workspace",
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime ?? null,
        url: file.webViewLink ?? null,
        description: file.description?.slice(0, 1_000) ?? "",
        text,
      }),
    });
  }
  return sources;
}

async function searchGmail(input: {
  accessToken: string;
  query: string;
  fetchImpl: typeof fetch;
}) {
  const terms = googleDriveSearchTerms(input.query);
  if (!terms.length) return [];
  const list = await googleRequest(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams(
      {
        q: `{${terms.join(" ")}}`,
        maxResults: "5",
        fields: "messages(id,threadId)",
      },
    )}`,
    input.accessToken,
    {},
    input.fetchImpl,
  );
  const messages =
    gmailMessageListSchema.parse(await list.json()).messages ?? [];
  const details = await Promise.allSettled(
    messages.map(async ({ id }) => {
      const params = new URLSearchParams({
        format: "metadata",
        fields: "id,threadId,snippet,internalDate,payload(headers)",
      });
      for (const header of ["Subject", "From", "Date"])
        params.append("metadataHeaders", header);
      const response = await googleRequest(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${params}`,
        input.accessToken,
        {},
        input.fetchImpl,
      );
      const message = gmailMessageSchema.parse(await response.json());
      const headers = new Map(
        (message.payload?.headers ?? []).map((header) => [
          header.name.toLowerCase(),
          header.value,
        ]),
      );
      const timestamp = Number(message.internalDate);
      return {
        id: `google:gmail:${message.id}`,
        type: "external_file" as const,
        label: headers.get("subject")?.slice(0, 300) || "Gmail message",
        content: JSON.stringify({
          provider: "Google Workspace Gmail",
          from: headers.get("from")?.slice(0, 500) ?? null,
          date:
            headers.get("date") ??
            (Number.isFinite(timestamp)
              ? new Date(timestamp).toISOString()
              : null),
          snippet: message.snippet?.slice(0, 2_000) ?? "",
          url: `https://mail.google.com/mail/u/0/#all/${message.id}`,
        }),
      };
    }),
  );
  return details.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}

async function searchGoogleCalendar(input: {
  accessToken: string;
  query: string;
  fetchImpl: typeof fetch;
}) {
  const terms = googleDriveSearchTerms(input.query);
  if (!terms.length) return [];
  const response = await googleRequest(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams(
      {
        q: terms.join(" "),
        maxResults: "5",
        maxAttendees: "20",
        singleEvents: "true",
        orderBy: "startTime",
        timeMin: new Date().toISOString(),
        fields:
          "items(id,summary,description,location,htmlLink,start,end,attendees(email,displayName,responseStatus))",
      },
    )}`,
    input.accessToken,
    {},
    input.fetchImpl,
  );
  return (calendarEventListSchema.parse(await response.json()).items ?? []).map(
    (event) => ({
      id: `google:calendar:${event.id}`,
      type: "external_file" as const,
      label: event.summary?.slice(0, 300) || "Calendar event",
      content: JSON.stringify({
        provider: "Google Workspace Calendar",
        description: event.description?.slice(0, 2_000) ?? "",
        location: event.location?.slice(0, 500) ?? null,
        start: event.start?.dateTime ?? event.start?.date ?? null,
        end: event.end?.dateTime ?? event.end?.date ?? null,
        attendees: (event.attendees ?? []).map((attendee) => ({
          name: attendee.displayName ?? null,
          email: attendee.email ?? null,
          response: attendee.responseStatus ?? null,
        })),
        url: event.htmlLink ?? null,
      }),
    }),
  );
}

export async function searchGoogleWorkspaceWithCoverage(input: {
  accessToken: string;
  query: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const results = await Promise.allSettled([
    searchGoogleDrive({ ...input, fetchImpl }),
    searchGmail({ ...input, fetchImpl }),
    searchGoogleCalendar({ ...input, fetchImpl }),
  ]);
  const sources = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  return {
    sources,
    coverage: results.map((result, index) => ({
      source: ["Drive", "Gmail", "Calendar"][index]!,
      status: result.status === "fulfilled" ? "searched" : "unavailable",
      count: result.status === "fulfilled" ? result.value.length : 0,
    })),
  };
}

export async function searchGoogleWorkspace(
  input: Parameters<typeof searchGoogleWorkspaceWithCoverage>[0],
) {
  return (await searchGoogleWorkspaceWithCoverage(input)).sources;
}

export async function createGoogleWorkspaceFile(input: {
  accessToken: string;
  actionKey: string;
  fileType: "google_doc" | "google_sheet";
  name: string;
  content: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const escapedKey = escapeDriveQuery(input.actionKey);
  const existingParams = new URLSearchParams({
    q: `trashed = false and appProperties has { key='hrmnyActionKey' and value='${escapedKey}' }`,
    pageSize: "1",
    fields: "files(id,name,mimeType,webViewLink,appProperties)",
  });
  const existingResponse = await googleRequest(
    `https://www.googleapis.com/drive/v3/files?${existingParams}`,
    input.accessToken,
    {},
    fetchImpl,
  );
  let file = driveFileListSchema.parse(await existingResponse.json()).files[0];
  if (!file) {
    const created = await googleRequest(
      "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink",
      input.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          mimeType:
            input.fileType === "google_doc"
              ? "application/vnd.google-apps.document"
              : "application/vnd.google-apps.spreadsheet",
          appProperties: { hrmnyActionKey: input.actionKey },
        }),
      },
      fetchImpl,
    );
    file = driveFileSchema.parse(await created.json());
  }

  const contentHash = createHash("sha256").update(input.content).digest("hex");
  if (file.appProperties?.hrmnyContentHash !== contentHash) {
    if (input.content) {
      if (input.fileType === "google_doc") {
        const document = z
          .object({
            body: z.object({
              content: z.array(z.object({ endIndex: z.number().optional() })),
            }),
          })
          .parse(
            await (
              await googleRequest(
                `https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}`,
                input.accessToken,
                {},
                fetchImpl,
              )
            ).json(),
          );
        const endIndex = Math.max(
          1,
          ...document.body.content.map((entry) => entry.endIndex ?? 1),
        );
        await googleRequest(
          `https://docs.googleapis.com/v1/documents/${encodeURIComponent(file.id)}:batchUpdate`,
          input.accessToken,
          {
            method: "POST",
            body: JSON.stringify({
              requests: [
                ...(endIndex > 2
                  ? [
                      {
                        deleteContentRange: {
                          range: { startIndex: 1, endIndex: endIndex - 1 },
                        },
                      },
                    ]
                  : []),
                ...(input.content
                  ? [
                      {
                        insertText: {
                          location: { index: 1 },
                          text: input.content,
                        },
                      },
                    ]
                  : []),
              ],
            }),
          },
          fetchImpl,
        );
      } else {
        await googleRequest(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(file.id)}/values:batchClear`,
          input.accessToken,
          { method: "POST", body: JSON.stringify({ ranges: ["A:ZZZ"] }) },
          fetchImpl,
        );
        await googleRequest(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(file.id)}/values/A1?valueInputOption=RAW`,
          input.accessToken,
          {
            method: "PUT",
            body: JSON.stringify({
              values: input.content
                .split("\n")
                .slice(0, 1_000)
                .map((line) => line.split("\t").slice(0, 50)),
            }),
          },
          fetchImpl,
        );
      }
    }
    await googleRequest(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?fields=id`,
      input.accessToken,
      {
        method: "PATCH",
        body: JSON.stringify({
          appProperties: {
            hrmnyActionKey: input.actionKey,
            hrmnyContentHash: contentHash,
          },
        }),
      },
      fetchImpl,
    );
  }
  return {
    id: file.id,
    name: file.name,
    url:
      file.webViewLink ??
      (input.fileType === "google_doc"
        ? `https://docs.google.com/document/d/${file.id}/edit`
        : `https://docs.google.com/spreadsheets/d/${file.id}/edit`),
  };
}
