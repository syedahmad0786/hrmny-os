/**
 * POST /api/webhooks/n8n — callback ingress from hrmny n8n Cloud.
 *
 * Verify `X-Hrmny-N8n-Signature` (or `X-N8n-Signature`) against N8N_WEBHOOK_SECRET:
 * - `sha256=<hex>` → HMAC-SHA256 of the raw body (preferred; add a Crypto node in n8n)
 * - otherwise → the shared secret sent verbatim as a static header token
 * Both compares are constant-time. Fails closed: no secret configured ⇒ reject in
 * production; unsigned bodies are never trusted.
 *
 * Lead events are forwarded into durable CRM via leads.inbound.create.
 * Instance: https://hrmny.app.n8n.cloud (see 11-N8N-SETUP.md)
 */
import { NextResponse } from "next/server";
import { createCaller } from "@/server/trpc/root";
import { verifyN8nSignature } from "./verify";

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

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
    pickString(body.event) ??
    pickString(body.workflowName) ??
    pickString(body.type) ??
    "unknown";

  const looksLikeLead =
    /lead/i.test(event) ||
    Boolean(pickString(body.email) || pickString(body.contactEmail)) ||
    Boolean(pickString(body.company) || pickString(body.companyName));

  if (looksLikeLead) {
    const companyName =
      pickString(body.companyName) ??
      pickString(body.company) ??
      pickString(body.name);
    const contactEmail = (
      pickString(body.contactEmail) ?? pickString(body.email) ?? ""
    ).toLowerCase();
    if (!companyName || !contactEmail) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION",
          reason: "lead event needs company + email",
          event,
        },
        { status: 400 },
      );
    }
    const caller = createCaller({
      user: null,
      employeeId: null,
      roles: [],
      canViewMargin: false,
    });
    try {
      const created = await caller.leads.inbound.create({
        companyName,
        contactEmail,
        sector: pickString(body.sector) ?? undefined,
        message:
          pickString(body.message) ??
          (pickString(body.source) ? `Source: ${pickString(body.source)}` : undefined),
      });
      return NextResponse.json({
        ok: true,
        received: true,
        event,
        verified: verify.reason,
        dealId: created.dealId,
        leadSourceLane: created.leadSourceLane,
      });
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          code: "INTERNAL",
          event,
          reason: err instanceof Error ? err.message.slice(0, 200) : "create_failed",
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    received: true,
    event,
    verified: verify.reason,
    handled: false,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/webhooks/n8n",
    methods: ["POST"],
    signature:
      "X-Hrmny-N8n-Signature or X-N8n-Signature (HMAC-SHA256 or shared secret)",
    docs: "hrmny_OS_Execution/11-N8N-SETUP.md",
  });
}
