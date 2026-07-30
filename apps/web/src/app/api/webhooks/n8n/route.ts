/**
 * POST /api/webhooks/n8n — callback ingress from hrmny n8n Cloud.
 *
 * Verify `X-Hrmny-N8n-Signature` (or `X-N8n-Signature`) against N8N_WEBHOOK_SECRET:
 * - `sha256=<hex>` → HMAC-SHA256 of the raw body (preferred; add a Crypto node in n8n)
 * - otherwise → the shared secret sent verbatim as a static header token
 * Both compares are constant-time. Fails closed: no secret configured ⇒ reject in
 * production; unsigned bodies are never trusted.
 *
 * Instance: https://hrmny.app.n8n.cloud (see 11-N8N-SETUP.md)
 */
import { NextResponse } from "next/server";
import { verifyN8nSignature } from "./verify";

export async function POST(request: Request) {
  const raw = await request.text();
  const signature =
    request.headers.get("x-hrmny-n8n-signature") ??
    request.headers.get("x-n8n-signature");

  const verify = verifyN8nSignature(raw, signature);
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
    signature: "X-Hrmny-N8n-Signature or X-N8n-Signature (HMAC-SHA256 or shared secret)",
    docs: "hrmny_OS_Execution/11-N8N-SETUP.md",
  });
}
