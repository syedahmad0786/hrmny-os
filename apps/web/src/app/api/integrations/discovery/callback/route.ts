import { acceptDiscoveryRuntimeCallback } from "@/server/sales-os/discovery-callbacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** n8n claim/checkpoint/completion only. This route never starts another module. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await acceptDiscoveryRuntimeCallback({
    rawBody,
    headers: request.headers,
  });
  if (result.status === "rejected")
    return Response.json(
      { ok: false, code: result.code },
      { status: result.httpStatus },
    );
  return Response.json({
    ok: true,
    status: result.status,
    eventId: result.eventId,
  });
}
