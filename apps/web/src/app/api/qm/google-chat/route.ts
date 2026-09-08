import { createHash, timingSafeEqual } from "node:crypto";
import {
  operateQmGoogleChat,
  qmChatWorkerRequest,
} from "@/server/qm/google-chat-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = process.env.QM_CHAT_BRIDGE_TOKEN ?? "";
  const provided = request.headers.get("authorization") ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (
    secret.length < 32 ||
    secret.length > 256 ||
    provided.length > 270 ||
    !timingSafeEqual(hash(provided), hash(`Bearer ${secret}`))
  )
    return Response.json({ error: "QM_CHAT_ACCESS_DENIED" }, { status: 403 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "INVALID_BODY" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128_000)
        return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = qmChatWorkerRequest.safeParse(input);
  if (!parsed.success)
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return Response.json(await operateQmGoogleChat(parsed.data), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const expected = new Set([
      "QM_CHAT_DISABLED",
      "QM_CHAT_LEASE_LOST",
      "QM_CHAT_STAFF_REVOKED",
      "QM_CHAT_RUN_CHANGED",
    ]);
    return Response.json(
      { error: expected.has(code) ? code : "QM_CHAT_UNAVAILABLE" },
      {
        status:
          code === "QM_CHAT_STAFF_REVOKED"
            ? 403
            : expected.has(code)
              ? 409
              : 503,
      },
    );
  }
}
