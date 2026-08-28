import { NextResponse } from "next/server";
import { z } from "zod";
import { createInboundLead } from "@/server/crm/inbound-leads";
import { verifyN8nSignature } from "../../webhooks/n8n/verify";

/**
 * POST /api/inbound/lead — n8n (and other automations) forward normalized leads.
 * Auth: X-Webhook-Secret must match N8N_WEBHOOK_SECRET / HRMNY_N8N_WEBHOOK_SECRET.
 * Body accepts either OS fields (companyName/contactEmail) or n8n normalize shape
 * (company/email/name/source).
 */

const bodySchema = z
  .object({
    companyName: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    contactEmail: z.string().email().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    sector: z.string().optional(),
    source: z.string().optional(),
    message: z.string().optional(),
    eventId: z.string().min(1).max(300).optional(),
  })
  .passthrough();

export async function POST(request: Request) {
  const rawBody = await request.text();
  const provided =
    request.headers.get("x-webhook-secret") ??
    request.headers.get("x-hrmny-n8n-signature") ??
    request.headers.get("x-n8n-signature");
  const verified = verifyN8nSignature(rawBody, provided);
  if (!verified.ok) {
    const misconfigured = verified.reason.includes("not configured");
    return NextResponse.json(
      {
        ok: false,
        code: misconfigured ? "MISCONFIGURED" : "UNAUTHORIZED",
        reason: verified.reason,
      },
      { status: misconfigured ? 503 : 401 },
    );
  }

  let raw: unknown;
  try {
    raw = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json(
      { ok: false, code: "VALIDATION", reason: "invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION", reason: parsed.error.message },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const idempotencyKey =
    request.headers.get("idempotency-key")?.trim() ||
    request.headers.get("x-event-id")?.trim() ||
    request.headers.get("x-webhook-id")?.trim() ||
    data.eventId?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        ok: false,
        code: "VALIDATION",
        reason: "Idempotency-Key or eventId required",
      },
      { status: 400 },
    );
  }
  const companyName = (data.companyName ?? data.company ?? data.name ?? "").trim();
  const contactEmail = (data.contactEmail ?? data.email ?? "").trim().toLowerCase();
  if (!companyName || !contactEmail) {
    return NextResponse.json(
      {
        ok: false,
        code: "VALIDATION",
        reason: "companyName/company and contactEmail/email required",
      },
      { status: 400 },
    );
  }

  const messageParts = [
    data.message?.trim(),
    data.name && data.company ? `Contact: ${data.name}` : null,
    data.source ? `Source: ${data.source}` : null,
  ].filter(Boolean);

  try {
    const created = await createInboundLead({
      provider: "n8n",
      idempotencyKey,
      companyName,
      contactEmail,
      sector: data.sector,
      message: messageParts.length ? messageParts.join("\n") : undefined,
      rawBody,
    });
    return NextResponse.json({
      ok: true,
      dealId: created.dealId,
      companyName: created.companyName,
      contactEmail: created.contactEmail,
      leadSourceLane: created.leadSourceLane,
      durable: created.durable,
      duplicate: created.duplicate,
      receipt: idempotencyKey,
    });
  } catch (err) {
    const reason =
      err instanceof Error ? err.message.slice(0, 200) : "create_failed";
    const conflict = reason === "IDEMPOTENCY_PAYLOAD_MISMATCH";
    return NextResponse.json(
      {
        ok: false,
        code: conflict ? "CONFLICT" : "INTERNAL",
        reason,
      },
      { status: conflict ? 409 : 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/inbound/lead",
    methods: ["POST"],
    auth: "X-Webhook-Secret",
    idempotency: "Idempotency-Key header (or eventId body field) is required",
  });
}
