import { campaignItems, desc, eq, sql, type Db } from "@hrmny/db";
import {
  bootstrapGateRegistry,
  transition,
  type ActorContext,
  type AuditWriter,
  type EmitHook,
} from "@hrmny/gate";
import type {
  SocialChannel,
  SocialPublishAdapter,
} from "@hrmny/integrations";
import { getDb } from "../db";
import { addFeedback } from "./feedback";
import { emitHealthSignal, writeAudit } from "../m1-persistence";
import {
  getCampaignMemory,
  newCampaignId,
  type CampaignItemRow,
  type CampaignStatus,
} from "./memory";

export type { CampaignItemRow, CampaignStatus } from "./memory";

/**
 * Campaigns durable layer (M9). Postgres over campaign_items when DATABASE_URL
 * is set, else the seeded in-memory store — same shape as crm/repository.ts.
 * Every campaign status change and every portal approval routes through the
 * gate engine (entityType "campaign" / "portal_item"); external publish is a
 * SocialPublishAdapter stub fired only from inside the approved→published gate.
 */

// portal_item state is DERIVED from campaign_items, not stored: the status
// column's CHECK is (draft|approved|published|archived) with no room for
// pending/rejected, so the rejection marker lives in `body.clientDecision`.
// Modelling it as a derivation avoids a portal_items table (migration 0062).
export type PortalItemState = "pending_client" | "approved" | "rejected";

const CAMPAIGN_STAFF_ROLES = new Set([
  "partner",
  "director",
  "am",
  "account_manager",
  "creative_director",
  "traffic",
  "marketing",
]);

function iso(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString();
  return d instanceof Date ? d.toISOString() : String(d);
}

function mapItem(r: typeof campaignItems.$inferSelect): CampaignItemRow {
  return {
    campaignItemId: r.campaignItemId,
    title: r.title,
    channel: r.channel as SocialChannel,
    status: r.status as CampaignStatus,
    scheduledFor: r.scheduledFor ?? null,
    clientId: r.clientId ?? null,
    body: (r.body ?? {}) as Record<string, unknown>,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

async function withDb<T>(
  fn: (db: Db) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback();
  return fn(db);
}

export type CampaignBackend = "postgres" | "memory";

export function campaignBackendMode(): CampaignBackend {
  return getDb() ? "postgres" : "memory";
}

// ── CRUD ───────────────────────────────────────────────────

export async function listCampaigns(q?: {
  clientId?: string;
  status?: CampaignStatus;
}): Promise<CampaignItemRow[]> {
  return withDb(
    async (db) => {
      const rows = await db
        .select()
        .from(campaignItems)
        .orderBy(desc(campaignItems.updatedAt));
      let out = rows.map(mapItem);
      if (q?.clientId) out = out.filter((c) => c.clientId === q.clientId);
      if (q?.status) out = out.filter((c) => c.status === q.status);
      return out;
    },
    () => {
      let rows = [...getCampaignMemory().items.values()];
      if (q?.clientId) rows = rows.filter((c) => c.clientId === q.clientId);
      if (q?.status) rows = rows.filter((c) => c.status === q.status);
      return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  );
}

export async function getCampaign(id: string): Promise<CampaignItemRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(campaignItems)
        .where(eq(campaignItems.campaignItemId, id))
        .limit(1);
      return row ? mapItem(row) : null;
    },
    () => getCampaignMemory().items.get(id) ?? null,
  );
}

export async function createCampaignDraft(input: {
  title: string;
  channel: SocialChannel;
  scheduledFor?: string | null;
  clientId?: string | null;
  body?: Record<string, unknown>;
}): Promise<CampaignItemRow> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(campaignItems)
        .values({
          title: input.title,
          channel: input.channel,
          status: "draft",
          scheduledFor: input.scheduledFor ?? null,
          clientId: input.clientId ?? null,
          body: input.body ?? {},
        })
        .returning();
      return mapItem(row!);
    },
    () => {
      const t = new Date().toISOString();
      const row: CampaignItemRow = {
        campaignItemId: newCampaignId(),
        title: input.title,
        channel: input.channel,
        status: "draft",
        scheduledFor: input.scheduledFor ?? null,
        clientId: input.clientId ?? null,
        body: input.body ?? {},
        createdAt: t,
        updatedAt: t,
      };
      getCampaignMemory().items.set(row.campaignItemId, row);
      return row;
    },
  );
}

/** Internal — status/body mutations only flow through the gate services below. */
async function updateCampaign(
  id: string,
  patch: Partial<
    Pick<CampaignItemRow, "status" | "body" | "scheduledFor" | "title">
  >,
): Promise<CampaignItemRow | null> {
  return withDb(
    async (db) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.body !== undefined) set.body = patch.body;
      if (patch.scheduledFor !== undefined) set.scheduledFor = patch.scheduledFor;
      if (patch.title !== undefined) set.title = patch.title;
      const [row] = await db
        .update(campaignItems)
        .set(set)
        .where(eq(campaignItems.campaignItemId, id))
        .returning();
      return row ? mapItem(row) : null;
    },
    () => {
      const mem = getCampaignMemory();
      const existing = mem.items.get(id);
      if (!existing) return null;
      const next = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      mem.items.set(id, next);
      return next;
    },
  );
}

// ── Portal-approval derivation ─────────────────────────────

export function portalStateOf(row: CampaignItemRow): PortalItemState {
  if (row.status === "approved" || row.status === "published") return "approved";
  if (row.body?.clientDecision === "rejected") return "rejected";
  return "pending_client";
}

function stripDecision(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...body };
  delete next.clientDecision;
  delete next.clientFeedback;
  return next;
}

export type PortalItemView = {
  campaignItemId: string;
  title: string;
  channel: SocialChannel;
  state: PortalItemState;
  scheduledFor: string | null;
  clientId: string | null;
  feedback: string | null;
};

function toPortalItemView(row: CampaignItemRow): PortalItemView {
  return {
    campaignItemId: row.campaignItemId,
    title: row.title,
    channel: row.channel,
    state: portalStateOf(row),
    scheduledFor: row.scheduledFor,
    clientId: row.clientId,
    feedback: (row.body?.clientFeedback as string | undefined) ?? null,
  };
}

/** Approval lens over campaign items (archived hidden). Portal scopes by client. */
export async function listApprovalViews(q?: {
  clientId?: string;
  state?: PortalItemState;
}): Promise<PortalItemView[]> {
  const rows = (
    await listCampaigns(q?.clientId ? { clientId: q.clientId } : undefined)
  ).filter((r) => r.status !== "archived");
  let views = rows.map(toPortalItemView);
  if (q?.state) views = views.filter((v) => v.state === q.state);
  return views;
}

// ── SocialPublishAdapter stub (mock-first) ─────────────────

export function createSocialPublishStub(): SocialPublishAdapter {
  return {
    mode: "mock",
    async listChannels() {
      return ["linkedin", "instagram", "facebook", "x"];
    },
    async publishAfterApproval(input) {
      // Honest stub: do not claim a real social post. Callers must not
      // durable-mark campaigns published on mode=stub.
      return {
        published: false,
        mode: "stub",
        externalId: `stub-${input.channel}-${Date.now()}`,
        channel: input.channel,
      };
    },
  };
}

// ── Gate wiring ────────────────────────────────────────────

const defaultAudit: AuditWriter = async (event) => {
  const row = await writeAudit({
    actorEmployeeId: event.actorEmployeeId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    before: event.before,
    after: event.after,
    reason: event.reason ?? null,
  });
  return { auditId: row.auditEventId };
};

function makeGateDeps(
  signalKey: string,
  audit?: AuditWriter,
  emit?: EmitHook,
): { audit: AuditWriter; emit: EmitHook } {
  return {
    audit: audit ?? defaultAudit,
    emit:
      emit ??
      (async (event) => {
        const blocked = event.name.endsWith("transition_blocked");
        await emitHealthSignal(
          blocked ? "gate_blocked" : signalKey,
          blocked ? "warn" : "info",
          event.payload,
        );
      }),
  };
}

export type GateOutcome =
  | { ok: true; item: CampaignItemRow; state: PortalItemState; auditId: string }
  | {
      ok: false;
      reason: string;
      code?: string;
      blockedBy?: { gate: string; reason: string }[];
      auditId?: string;
    };

/**
 * Staff campaign transition (draft→approved→published→archived). Publish is the
 * only external side effect and it fires the SocialPublishAdapter stub from
 * inside the approved→published gate — never auto-fired.
 */
export async function transitionCampaign(opts: {
  actor: ActorContext;
  id: string;
  to: string;
  overrideReason?: string | null;
  publisher?: SocialPublishAdapter;
  audit?: AuditWriter;
  emit?: EmitHook;
}): Promise<GateOutcome> {
  bootstrapGateRegistry();
  const existing = await getCampaign(opts.id);
  if (!existing) return { ok: false, reason: "Campaign item not found" };
  const publisher = opts.publisher ?? createSocialPublishStub();

  const result = await transition(
    opts.actor,
    {
      entityType: "campaign",
      entityId: existing.campaignItemId,
      state: existing.status,
      data: { ...existing },
    },
    {
      to: opts.to,
      from: existing.status,
      overrideReason: opts.overrideReason ?? null,
    },
    {
      authorize: async (a) => a.roles.some((r) => CAMPAIGN_STAFF_ROLES.has(r)),
      apply: async ({ request }) => {
        const patch: Partial<CampaignItemRow> = {
          status: request.to as CampaignStatus,
        };
        if (request.to === "published") {
          const published = await publisher.publishAfterApproval({
            channel: existing.channel,
            content: String(
              (existing.body.brief as string | undefined) ?? existing.title,
            ),
          });
          if (!published.published || published.mode === "stub") {
            throw new Error(
              "Social publish is not live. Connect LinkedIn (or inject a live publisher) — campaign stays approved.",
            );
          }
          patch.body = { ...existing.body, publish: published };
        }
        const updated = await updateCampaign(existing.campaignItemId, patch);
        if (!updated) throw new Error("Campaign update failed during apply");
        return {
          entityType: "campaign",
          entityId: updated.campaignItemId,
          state: updated.status,
          data: { ...updated },
        };
      },
      ...makeGateDeps("campaign_transition", opts.audit, opts.emit),
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      reason: result.code,
      code: result.code,
      blockedBy: result.blockedBy,
      auditId: result.auditId,
    };
  }
  const item = await getCampaign(opts.id);
  if (!item) return { ok: false, reason: "Campaign missing after apply" };
  return { ok: true, item, state: portalStateOf(item), auditId: result.auditId };
}

/**
 * Client-side portal decision (pending_client→approved/rejected). The
 * portalItemClientApproverGate enforces the portal_client role, so `authorize`
 * only scopes the item to the caller's client — a wrong-role staff actor still
 * reaches the gate and is denied there. Approval unlocks staff publish by
 * advancing the campaign draft→approved; rejection parks a decision marker.
 */
export async function decidePortalItem(opts: {
  actor: ActorContext;
  clientId?: string | null;
  id: string;
  to: "approved" | "rejected";
  feedback?: string;
  audit?: AuditWriter;
  emit?: EmitHook;
}): Promise<GateOutcome> {
  bootstrapGateRegistry();
  const existing = await getCampaign(opts.id);
  if (!existing) return { ok: false, reason: "Portal item not found" };
  // Reject-with-feedback: a rejection must carry a reason. The gate transition
  // itself is unchanged; the body is recorded alongside as a client thread
  // comment (below) and in the audit trail via the gate's audit hook.
  const feedback = opts.feedback?.trim();
  if (opts.to === "rejected" && !feedback) {
    return { ok: false, reason: "FEEDBACK_REQUIRED", code: "FEEDBACK_REQUIRED" };
  }
  const fromState = portalStateOf(existing);

  const result = await transition(
    opts.actor,
    {
      entityType: "portal_item",
      entityId: existing.campaignItemId,
      state: fromState,
      data: { ...existing },
    },
    { to: opts.to, from: fromState },
    {
      authorize: async () =>
        opts.clientId == null || existing.clientId === opts.clientId,
      apply: async ({ request }) => {
        const patch: Partial<CampaignItemRow> =
          request.to === "approved"
            ? { status: "approved", body: stripDecision(existing.body) }
            : {
                body: {
                  ...existing.body,
                  clientDecision: "rejected",
                  clientFeedback: opts.feedback ?? null,
                },
              };
        const updated = await updateCampaign(existing.campaignItemId, patch);
        if (!updated) throw new Error("Portal item update failed during apply");
        return {
          entityType: "portal_item",
          entityId: updated.campaignItemId,
          state: portalStateOf(updated),
          data: { ...updated },
        };
      },
      ...makeGateDeps("portal_item_transition", opts.audit, opts.emit),
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      reason: result.code,
      code: result.code,
      blockedBy: result.blockedBy,
      auditId: result.auditId,
    };
  }
  const item = await getCampaign(opts.id);
  if (!item) return { ok: false, reason: "Portal item missing after apply" };
  if (opts.to === "rejected" && feedback) {
    await addFeedback({
      campaignItemId: item.campaignItemId,
      authorKind: "client",
      authorId: opts.actor.employeeId,
      clientId: item.clientId,
      body: feedback,
    });
  }
  if (item.clientId) {
    await notifyStaffOfCampaignDecision({
      clientId: item.clientId,
      campaignItemId: item.campaignItemId,
      title: item.title,
      action: opts.to === "approved" ? "approve" : "reject",
      feedback,
    });
  }
  return { ok: true, item, state: portalStateOf(item), auditId: result.auditId };
}

async function resolveStaffForCampaignClient(
  clientId: string,
): Promise<string | null> {
  const { getDb } = await import("../db");
  const db = getDb();
  if (!db) {
    const { DEMO_EMPLOYEE_ID } = await import("../demo-store");
    return DEMO_EMPLOYEE_ID;
  }
  try {
    const { sql } = await import("@hrmny/db");
    const leads = await db.execute<{ employeeId: string }>(sql`
      select employee_id as "employeeId"
      from public.account_team_member
      where client_id = ${clientId}::uuid
        and is_account_lead = true
      order by created_at asc
      limit 1
    `);
    if (leads[0]?.employeeId) return leads[0].employeeId;
    const anyStaff = await db.execute<{ employeeId: string }>(sql`
      select employee_id as "employeeId"
      from public.employee
      where is_active = true
      order by created_at asc
      limit 1
    `);
    return anyStaff[0]?.employeeId ?? null;
  } catch {
    return null;
  }
}

/** Staff OS inbox + memory after client campaign approve/reject. */
export async function notifyStaffOfCampaignDecision(input: {
  clientId: string;
  campaignItemId: string;
  title: string;
  action: "approve" | "reject";
  feedback?: string;
}): Promise<void> {
  const employeeId = await resolveStaffForCampaignClient(input.clientId);
  if (!employeeId) return;

  const label = input.title.trim() || "campaign";
  const verb =
    input.action === "approve" ? "approved" : "requested changes on";
  const title =
    input.action === "approve"
      ? `Client approved campaign: ${label}`
      : `Client campaign revisions: ${label}`;
  const body = [
    `Client ${verb} "${label}".`,
    input.feedback?.trim() ? `Feedback: ${input.feedback.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const { notifyEmployee } = await import("../notifications/store");
  await notifyEmployee({
    employeeId,
    title,
    body,
    kind: "campaign",
    href: `/approvals?clientId=${encodeURIComponent(input.clientId)}`,
    entityType: "campaign_item",
    entityId: input.campaignItemId,
  }).catch(() => undefined);

  const { persistMemoryChunk } = await import("../ai/memory-db");
  await persistMemoryChunk({
    sourceType: "feedback",
    sourceId: input.campaignItemId,
    content: `Portal campaign ${input.action}: client ${verb} "${label}".${
      input.feedback?.trim() ? ` Feedback: ${input.feedback.trim()}` : ""
    }`,
    metadata: {
      clientId: input.clientId,
      employeeId,
      campaignItemId: input.campaignItemId,
      kind: `portal.campaign.${input.action}`,
    },
  }).catch(() => undefined);
}

export type CampaignHealth = {
  backend: CampaignBackend;
  items: number;
};

export async function campaignHealth(): Promise<CampaignHealth> {
  return withDb(
    async (db): Promise<CampaignHealth> => {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(campaignItems);
      return { backend: "postgres", items: Number(r?.n ?? 0) };
    },
    () => ({ backend: "memory", items: getCampaignMemory().items.size }),
  );
}
