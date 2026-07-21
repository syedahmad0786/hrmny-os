/**
 * POST /api/webhooks/n8n — callback ingress from hrmny n8n Cloud.
 *
 * Plan:
 * - Verify `X-Hrmny-N8n-Signature` (or N8N_WEBHOOK_SECRET header) — stub for now
 * - Route by `event` / `workflowName` into CRM / tickets / memory / health
 * - Never trust body without signature in production
 *
 * Instance: https://hrmny.app.n8n.cloud (see 11-N8N-SETUP.md)
 */
import { NextResponse } from "next/server";

function verifySignatureStub(
  _rawBody: string,
  signatureHeader: string | null,
): { ok: boolean; reason: string } {
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Dev-friendly: accept when secret unset, but flag unverified.
    return {
      ok: true,
      reason: "N8N_WEBHOOK_SECRET unset — signature verify stubbed (dev only)",
    };
  }
  if (!signatureHeader) {
    return { ok: false, reason: "missing signature header" };
  }
  // Stub: constant-time compare not implemented — reject unless exact match placeholder.
  if (signatureHeader === secret || signatureHeader === `sha256=${secret}`) {
    return { ok: true, reason: "stub match" };
  }
  return {
    ok: false,
    reason: "signature mismatch (stub verifier — replace with HMAC)",
  };
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature =
    request.headers.get("x-hrmny-n8n-signature") ??
    request.headers.get("x-n8n-signature");

  const verify = verifySignatureStub(raw, signature);
  if (!verify.ok) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", reason: verify.reason },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json(
      { ok: false, code: "VALIDATION", reason: "invalid JSON" },
      { status: 400 },
    );
  }

  const event =
    typeof body.event === "string"
      ? body.event
      : typeof body.workflowName === "string"
        ? body.workflowName
        : "unknown";

  // Stub: acknowledge only — CRM/ticket side-effects land in a later slice.
  return NextResponse.json({
    ok: true,
    received: true,
    event,
    verified: verify.reason,
    next: "wire to crm/tickets handlers — see 11-N8N-SETUP.md",
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/webhooks/n8n",
    methods: ["POST"],
    signature: "X-Hrmny-N8n-Signature or X-N8n-Signature (stub)",
    docs: "hrmny_OS_Execution/11-N8N-SETUP.md",
  });
}
