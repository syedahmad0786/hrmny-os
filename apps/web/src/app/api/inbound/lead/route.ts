import { NextResponse } from "next/server";
import { z } from "zod";
import { createCaller } from "@/server/trpc/root";
import { timingSafeEqual } from "node:crypto";

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
  })
  .passthrough();

function configuredSecret(): string | null {
  return (
    process.env.N8N_WEBHOOK_SECRET?.trim() ||
    process.env.HRMNY_N8N_WEBHOOK_SECRET?.trim() ||
    null
  );
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = configuredSecret();
  if (!expected) {
    return NextResponse.json(
      { ok: false, code: "MISCONFIGURED", reason: "webhook secret not set" },
      { status: 503 },
    );
  }
  const provided =
    request.headers.get("x-webhook-secret") ??
    request.headers.get("x-hrmny-n8n-signature") ??
    request.headers.get("x-n8n-signature");
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
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
      sector: data.sector,
      message: messageParts.length ? messageParts.join("\n") : undefined,
    });
    return NextResponse.json({
      ok: true,
      dealId: created.dealId,
      companyName: created.companyName,
      contactEmail: created.contactEmail,
      leadSourceLane: created.leadSourceLane,
      durable: "durable" in created ? created.durable : true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        reason: err instanceof Error ? err.message.slice(0, 200) : "create_failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/inbound/lead",
    methods: ["POST"],
    auth: "X-Webhook-Secret",
  });
}
