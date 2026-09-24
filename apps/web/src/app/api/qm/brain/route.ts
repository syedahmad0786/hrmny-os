import { readQmBrain } from "@/server/qm/brain-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const token = request.headers.get("x-agent-capability");
  if (!token || token.length > 16_384)
    return Response.json({ error: "QM_ACCESS_DENIED" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 8_192)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 8_192)
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  try {
    return Response.json(await readQmBrain(token, input), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "QM_BRAIN_UNAVAILABLE" }, { status: 403 });
  }
}
