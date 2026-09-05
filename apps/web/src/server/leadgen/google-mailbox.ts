import { z } from "zod";
import { getMessage, messageBody } from "./google-workspace-monitor";

const pageSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});
const metadataSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  snippet: z.string().default(""),
  internalDate: z.string().optional(),
  payload: z
    .object({
      headers: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .default([]),
    })
    .optional(),
});

async function gmailRead(token: string, path: string) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Mailbox could not load (${response.status}). Retry or reconnect this account.`,
    );
  return response.json();
}

export async function listGoogleMailboxPage(
  token: string,
  folder: "INBOX" | "SENT",
  pageToken?: string,
) {
  const query = new URLSearchParams({
    labelIds: folder,
    maxResults: "20",
    ...(pageToken ? { pageToken } : {}),
  });
  const page = pageSchema.parse(await gmailRead(token, `messages?${query}`));
  const messages = await Promise.all(
    page.messages.map(async ({ id }) => {
      const params = new URLSearchParams({ format: "metadata" });
      for (const name of ["From", "To", "Subject", "Date"])
        params.append("metadataHeaders", name);
      const message = metadataSchema.parse(
        await gmailRead(token, `messages/${encodeURIComponent(id)}?${params}`),
      );
      const header = (name: string) =>
        message.payload?.headers.find(
          (item) => item.name.toLowerCase() === name.toLowerCase(),
        )?.value ?? "";
      return {
        id: message.id,
        from: header("From"),
        to: header("To"),
        subject: header("Subject"),
        date: header("Date"),
        snippet: message.snippet,
      };
    }),
  );
  return { messages, nextPageToken: page.nextPageToken ?? null };
}

export async function readGoogleMailboxMessage(token: string, id: string) {
  return { body: messageBody(await getMessage(token, id, fetch)) };
}
