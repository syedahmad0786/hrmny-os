import { randomUUID } from "node:crypto";
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
import {
  getDemoStore,
  type DemoAudit,
  type DemoSeamOutboxRow,
} from "../demo-store";
import { addFeedback } from "./feedback";
import {
  PORTAL_IDENTITY_NOT_BOUND,
  portalApprovalPrincipalMatches,
  requireBoundPortalApprovalActor,
  requirePortalApprovalActor,
  requireSyntheticPortalApprovalPrincipal,
  type PortalApprovalActor,
  type PortalApprovalPrincipalRecord,
} from "../portal/approval-boundary";
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
      // OS-only stub publish: marks the campaign published in-app without
      // claiming a live social post (mode stays "stub" in the body).
      return {
        published: true,
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
  | {
      ok: true;
      item: CampaignItemRow;
      state: PortalItemState;
      auditId: string;
      changed?: boolean;
      receiptKey?: string;
      reconciled?: boolean;
    }
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
          if (!published.published) {
            throw new Error(
              "Social publish refused. Connect LinkedIn for live publish, or retry — campaign stays approved.",
            );
          }
          // Stub mode is allowed: OS records published + body.publish.mode=stub
          // so demos complete without LinkedIn OAuth (not a live social claim).
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

const CAMPAIGN_DECISION_EVENT = "portal.campaign.decision";

type CampaignDecisionAction = "approved" | "rejected";

type CampaignDecisionReceipt = {
  action: CampaignDecisionAction;
  feedback: string | null;
  portalUserId: string;
  decidedAt: string;
  auditId: string;
};

type CampaignDecisionPayload = CampaignDecisionReceipt & {
  clientId: string;
  campaignItemId: string;
  title: string;
};

type LockedCampaignRow = {
  campaignItemId: string;
  title: string;
  channel: string;
  status: string;
  scheduledFor: string | null;
  clientId: string | null;
  body: Record<string, unknown> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DecisionOutboxRow = {
  eventId: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  applied: boolean;
};

function campaignDecisionKey(id: string): string {
  return `${CAMPAIGN_DECISION_EVENT}:${id}`;
}

function normalizeDecisionFeedback(
  action: CampaignDecisionAction,
  feedback: string | undefined,
): string | null {
  if (action === "approved") return null;
  const value = feedback?.trim() ?? "";
  return value || null;
}

function recordedCampaignDecision(
  item: CampaignItemRow,
): CampaignDecisionReceipt | null {
  const action = item.body.clientDecision;
  const feedback = item.body.clientFeedback;
  const portalUserId = item.body.clientDecisionByPortalUserId;
  const decidedAt = item.body.clientDecisionAt;
  const auditId = item.body.clientDecisionAuditId;
  if (
    (action !== "approved" && action !== "rejected") ||
    typeof portalUserId !== "string" ||
    typeof decidedAt !== "string" ||
    typeof auditId !== "string"
  ) {
    return null;
  }
  return {
    action,
    feedback:
      action === "rejected" && typeof feedback === "string"
        ? feedback.trim()
        : null,
    portalUserId,
    decidedAt,
    auditId,
  };
}

function parseCampaignDecisionPayload(
  value: Record<string, unknown> | null | undefined,
): CampaignDecisionPayload | null {
  if (!value) return null;
  const action = value.action;
  if (
    (action !== "approved" && action !== "rejected") ||
    typeof value.clientId !== "string" ||
    typeof value.campaignItemId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.portalUserId !== "string" ||
    typeof value.decidedAt !== "string" ||
    typeof value.auditId !== "string"
  ) {
    return null;
  }
  return {
    action,
    feedback:
      action === "rejected" && typeof value.feedback === "string"
        ? value.feedback.trim()
        : null,
    clientId: value.clientId,
    campaignItemId: value.campaignItemId,
    title: value.title,
    portalUserId: value.portalUserId,
    decidedAt: value.decidedAt,
    auditId: value.auditId,
  };
}

function mapLockedCampaign(row: LockedCampaignRow): CampaignItemRow {
  return {
    campaignItemId: row.campaignItemId,
    title: row.title,
    channel: row.channel as SocialChannel,
    status: row.status as CampaignStatus,
    scheduledFor: row.scheduledFor,
    clientId: row.clientId,
    body: row.body ?? {},
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function campaignDecisionBody(
  item: CampaignItemRow,
  input: {
    action: CampaignDecisionAction;
    feedback: string | null;
    portalUserId: string;
    decidedAt: string;
    auditId?: string;
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...item.body,
    clientDecision: input.action,
    clientFeedback: input.feedback,
    clientDecisionByPortalUserId: input.portalUserId,
    clientDecisionAt: input.decidedAt,
  };
  if (input.auditId) body.clientDecisionAuditId = input.auditId;
  return body;
}

function campaignDecisionConflict(reason = "CONFLICT"): GateOutcome {
  return { ok: false, reason, code: "CONFLICT" };
}

function replayMatches(
  receipt: CampaignDecisionReceipt,
  action: CampaignDecisionAction,
  feedback: string | null,
): boolean {
  return (
    receipt.action === action &&
    (action === "approved" || receipt.feedback === feedback)
  );
}

const memoryDecisionLocks = new Map<string, Promise<void>>();

async function withMemoryDecisionLock<T>(
  campaignItemId: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = memoryDecisionLocks.get(campaignItemId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  memoryDecisionLocks.set(campaignItemId, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (memoryDecisionLocks.get(campaignItemId) === tail) {
      memoryDecisionLocks.delete(campaignItemId);
    }
  }
}

function campaignDecisionPayload(
  item: CampaignItemRow,
  receipt: CampaignDecisionReceipt,
): CampaignDecisionPayload {
  return {
    ...receipt,
    clientId: item.clientId!,
    campaignItemId: item.campaignItemId,
    title: item.title,
  };
}

function ensureMemoryDecisionIntent(
  item: CampaignItemRow,
  receipt: CampaignDecisionReceipt,
): void {
  const store = getDemoStore();
  const idempotencyKey = campaignDecisionKey(item.campaignItemId);
  if (store.seamOutbox.some((row) => row.idempotencyKey === idempotencyKey)) {
    return;
  }
  store.seamOutbox.unshift({
    eventId: randomUUID(),
    name: CAMPAIGN_DECISION_EVENT,
    idempotencyKey,
    payload: campaignDecisionPayload(item, receipt),
    createdAt: receipt.decidedAt,
    applied: false,
    result: null,
  });
}

function stageMemoryDecisionIntent(
  item: CampaignItemRow,
  receipt: CampaignDecisionReceipt,
): DemoSeamOutboxRow {
  return {
    eventId: randomUUID(),
    name: CAMPAIGN_DECISION_EVENT,
    idempotencyKey: campaignDecisionKey(item.campaignItemId),
    payload: campaignDecisionPayload(item, receipt),
    createdAt: receipt.decidedAt,
    applied: false,
    result: null,
  };
}

async function decidePortalItemMemory(opts: {
  actor: PortalApprovalActor;
  clientId: string;
  id: string;
  to: CampaignDecisionAction;
  feedback: string | null;
  audit?: AuditWriter;
}): Promise<GateOutcome> {
  return withMemoryDecisionLock(opts.id, async () => {
    await requireBoundPortalApprovalActor({
      actor: opts.actor,
      clientId: opts.clientId,
    });
    requireSyntheticPortalApprovalPrincipal({
      portalUserId: opts.actor.employeeId,
      clientId: opts.clientId,
    });
    const memory = getCampaignMemory();
    const existing = memory.items.get(opts.id);
    if (!existing || existing.clientId !== opts.clientId) {
      return { ok: false, reason: "Portal item not found" };
    }

    const fromState = portalStateOf(existing);
    if (fromState !== "pending_client") {
      const receipt = recordedCampaignDecision(existing);
      if (!receipt) {
        return campaignDecisionConflict("LEGACY_DECISION_UNATTRIBUTED");
      }
      if (!replayMatches(receipt, opts.to, opts.feedback)) {
        return campaignDecisionConflict();
      }
      ensureMemoryDecisionIntent(existing, receipt);
      return {
        ok: true,
        item: existing,
        state: fromState,
        auditId: receipt.auditId,
        changed: false,
        receiptKey: campaignDecisionKey(existing.campaignItemId),
      };
    }

    bootstrapGateRegistry();
    const store = getDemoStore();
    const decidedAt = new Date().toISOString();
    const staged: {
      item: CampaignItemRow | null;
      audit: DemoAudit | null;
      intent: DemoSeamOutboxRow | null;
    } = { item: null, audit: null, intent: null };
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
        authorize: async () => existing.clientId === opts.clientId,
        apply: async ({ request }) => {
          requireSyntheticPortalApprovalPrincipal({
            portalUserId: opts.actor.employeeId,
            clientId: opts.clientId,
          });
          const updated: CampaignItemRow = {
            ...existing,
            status:
              request.to === "approved" ? "approved" : existing.status,
            body: campaignDecisionBody(existing, {
              action: opts.to,
              feedback: opts.feedback,
              portalUserId: opts.actor.employeeId,
              decidedAt,
            }),
            updatedAt: decidedAt,
          };
          staged.item = updated;
          return {
            entityType: "portal_item",
            entityId: updated.campaignItemId,
            state: portalStateOf(updated),
            data: { ...updated },
          };
        },
        audit:
          opts.audit ??
          (async (event) => {
            const row: DemoAudit = {
              auditEventId: randomUUID(),
              actorEmployeeId: null,
              actorPortalUserId: opts.actor.employeeId,
              action: event.action,
              entityType: event.entityType,
              entityId: event.entityId,
              before: event.before,
              after: event.after,
              reason: event.reason ?? opts.feedback,
              createdAt: decidedAt,
            };
            staged.audit = row;
            return { auditId: row.auditEventId };
          }),
        emit: async (event) => {
          if (!event.name.endsWith("transitioned")) return;
          const auditId = String(event.payload.auditId ?? "");
          if (!auditId) throw new Error("CAMPAIGN_DECISION_AUDIT_REQUIRED");
          const current = staged.item;
          if (!current) throw new Error("Campaign item missing during receipt");
          current.body = campaignDecisionBody(current, {
            action: opts.to,
            feedback: opts.feedback,
            portalUserId: opts.actor.employeeId,
            decidedAt,
            auditId,
          });
          staged.intent = stageMemoryDecisionIntent(current, {
            action: opts.to,
            feedback: opts.feedback,
            portalUserId: opts.actor.employeeId,
            decidedAt,
            auditId,
          });
        },
      },
    );

    if (!result.ok) {
      // A blocked transition still has an immutable audit receipt. Publishing a
      // staged row is synchronous, so it cannot overwrite unrelated activity.
      if (staged.audit) store.audits.unshift(staged.audit);
      return {
        ok: false,
        reason: result.code,
        code: result.code,
        blockedBy: result.blockedBy,
        auditId: result.auditId,
      };
    }

    const item = staged.item;
    const intent = staged.intent;
    if (!item || !intent) {
      throw new Error("Campaign decision transaction was not fully staged");
    }

    // Commit the item, audit, and projection intent without an await between
    // writes. This is the in-memory equivalent of the PostgreSQL transaction
    // and avoids rolling shared arrays back over another item's decision.
    memory.items.set(existing.campaignItemId, item);
    if (staged.audit) store.audits.unshift(staged.audit);
    if (
      !store.seamOutbox.some(
        (row) => row.idempotencyKey === intent.idempotencyKey,
      )
    ) {
      store.seamOutbox.unshift(intent);
    }
    return {
      ok: true,
      item,
      state: portalStateOf(item),
      auditId: result.auditId,
      changed: true,
      receiptKey: campaignDecisionKey(item.campaignItemId),
    };
  });
}

async function decidePortalItemDb(
  db: Db,
  opts: {
    actor: PortalApprovalActor;
    clientId: string;
    id: string;
    to: CampaignDecisionAction;
    feedback: string | null;
  },
): Promise<GateOutcome> {
  return db.transaction(async (tx) => {
    const principals = await tx.execute<PortalApprovalPrincipalRecord>(sql`
      select
        client_portal_user_id as "portalUserId",
        client_id as "clientId",
        is_active as "isActive"
      from public.client_portal_user
      where client_portal_user_id = ${opts.actor.employeeId}::uuid
      limit 1
      for share
    `);
    if (
      !portalApprovalPrincipalMatches(
        { portalUserId: opts.actor.employeeId, clientId: opts.clientId },
        principals[0],
      )
    ) {
      throw new Error(PORTAL_IDENTITY_NOT_BOUND);
    }

    const rows = await tx.execute<LockedCampaignRow>(sql`
      select
        campaign_item_id as "campaignItemId",
        title,
        channel,
        status,
        scheduled_for::text as "scheduledFor",
        client_id as "clientId",
        body,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from public.campaign_items
      where campaign_item_id = ${opts.id}::uuid
        and client_id = ${opts.clientId}::uuid
      for update
    `);
    const existing = rows[0] ? mapLockedCampaign(rows[0]) : null;
    if (!existing) return { ok: false, reason: "Portal item not found" };

    const fromState = portalStateOf(existing);
    if (fromState !== "pending_client") {
      const receipt = recordedCampaignDecision(existing);
      if (!receipt) {
        return campaignDecisionConflict("LEGACY_DECISION_UNATTRIBUTED");
      }
      if (!replayMatches(receipt, opts.to, opts.feedback)) {
        return campaignDecisionConflict();
      }
      const key = campaignDecisionKey(existing.campaignItemId);
      const intents = await tx.execute<DecisionOutboxRow>(sql`
        select
          event_id as "eventId", payload, result, applied
        from public.seam_outbox
        where idempotency_key = ${key}
        limit 1
      `);
      const stored = parseCampaignDecisionPayload(intents[0]?.payload);
      if (
        stored &&
        (!replayMatches(stored, opts.to, opts.feedback) ||
          stored.auditId !== receipt.auditId)
      ) {
        return campaignDecisionConflict("DECISION_RECEIPT_CONFLICT");
      }
      if (!intents[0]) {
        await tx.execute(sql`
          insert into public.seam_outbox (
            name, idempotency_key, payload, result, applied
          ) values (
            ${CAMPAIGN_DECISION_EVENT},
            ${key},
            ${JSON.stringify(campaignDecisionPayload(existing, receipt))}::jsonb,
            null,
            false
          )
        `);
      }
      return {
        ok: true,
        item: existing,
        state: fromState,
        auditId: receipt.auditId,
        changed: false,
        receiptKey: key,
      };
    }

    bootstrapGateRegistry();
    const decidedAt = new Date().toISOString();
    let updatedItem: CampaignItemRow | null = null;
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
        authorize: async () => existing.clientId === opts.clientId,
        apply: async ({ request }) => {
          const body = campaignDecisionBody(existing, {
            action: opts.to,
            feedback: opts.feedback,
            portalUserId: opts.actor.employeeId,
            decidedAt,
          });
          const updated = await tx.execute<LockedCampaignRow>(sql`
            update public.campaign_items
            set
              status = ${request.to === "approved" ? "approved" : existing.status},
              body = ${JSON.stringify(body)}::jsonb,
              updated_at = now()
            where campaign_item_id = ${existing.campaignItemId}::uuid
              and client_id = ${opts.clientId}::uuid
            returning
              campaign_item_id as "campaignItemId",
              title,
              channel,
              status,
              scheduled_for::text as "scheduledFor",
              client_id as "clientId",
              body,
              created_at as "createdAt",
              updated_at as "updatedAt"
          `);
          if (!updated[0]) throw new Error("Portal item update failed during apply");
          updatedItem = mapLockedCampaign(updated[0]);
          return {
            entityType: "portal_item",
            entityId: updatedItem.campaignItemId,
            state: portalStateOf(updatedItem),
            data: { ...updatedItem },
          };
        },
        audit: async (event) => {
          const auditId = randomUUID();
          await tx.execute(sql`
            insert into public.audit_event (
              audit_event_id,
              actor_employee_id,
              actor_portal_user_id,
              action,
              entity_type,
              entity_id,
              before,
              after,
              reason
            ) values (
              ${auditId}::uuid,
              null,
              ${opts.actor.employeeId}::uuid,
              ${event.action},
              ${event.entityType},
              ${event.entityId}::uuid,
              ${JSON.stringify(event.before)}::jsonb,
              ${JSON.stringify(event.after)}::jsonb,
              ${event.reason ?? opts.feedback}
            )
          `);
          return { auditId };
        },
        emit: async (event) => {
          if (!event.name.endsWith("transitioned")) return;
          const auditId = String(event.payload.auditId ?? "");
          if (!auditId || !updatedItem) {
            throw new Error("CAMPAIGN_DECISION_AUDIT_REQUIRED");
          }
          const body = campaignDecisionBody(updatedItem, {
            action: opts.to,
            feedback: opts.feedback,
            portalUserId: opts.actor.employeeId,
            decidedAt,
            auditId,
          });
          await tx.execute(sql`
            update public.campaign_items
            set body = ${JSON.stringify(body)}::jsonb, updated_at = now()
            where campaign_item_id = ${existing.campaignItemId}::uuid
              and client_id = ${opts.clientId}::uuid
          `);
          updatedItem = { ...updatedItem, body };
          const receipt: CampaignDecisionReceipt = {
            action: opts.to,
            feedback: opts.feedback,
            portalUserId: opts.actor.employeeId,
            decidedAt,
            auditId,
          };
          await tx.execute(sql`
            insert into public.seam_outbox (
              name, idempotency_key, payload, result, applied
            ) values (
              ${CAMPAIGN_DECISION_EVENT},
              ${campaignDecisionKey(existing.campaignItemId)},
              ${JSON.stringify(campaignDecisionPayload(updatedItem, receipt))}::jsonb,
              null,
              false
            )
          `);
        },
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
    if (!updatedItem) throw new Error("Portal item missing after apply");
    return {
      ok: true,
      item: updatedItem,
      state: portalStateOf(updatedItem),
      auditId: result.auditId,
      changed: true,
      receiptKey: campaignDecisionKey(existing.campaignItemId),
    };
  });
}

function campaignDecisionNotificationCopy(payload: CampaignDecisionPayload): {
  title: string;
  body: string;
  href: string;
} {
  const label = payload.title.trim() || "campaign";
  const verb =
    payload.action === "approved" ? "approved" : "requested changes on";
  return {
    title:
      payload.action === "approved"
        ? `Client approved campaign: ${label}`
        : `Client campaign revisions: ${label}`,
    body: [
      `Client ${verb} "${label}".`,
      payload.feedback ? `Feedback: ${payload.feedback}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    href: `/approvals?id=${encodeURIComponent(payload.campaignItemId)}`,
  };
}

async function reconcileMemoryCampaignDecision(
  campaignItemId: string,
  hook?: EmitHook,
): Promise<boolean> {
  return withMemoryDecisionLock(campaignItemId, async () => {
    const key = campaignDecisionKey(campaignItemId);
    const event = getDemoStore().seamOutbox.find(
      (row) => row.idempotencyKey === key,
    );
    if (!event) throw new Error("CAMPAIGN_DECISION_INTENT_MISSING");
    if (event.applied) return true;
    const payload = parseCampaignDecisionPayload(event.payload);
    if (!payload) throw new Error("CAMPAIGN_DECISION_INTENT_INVALID");
    if (hook) {
      await hook({ name: CAMPAIGN_DECISION_EVENT, payload: event.payload });
    }
    let feedbackRecorded = false;
    if (payload.action === "rejected" && payload.feedback) {
      const existing = await import("./feedback").then(({ listFeedbackByItem }) =>
        listFeedbackByItem(payload.campaignItemId),
      );
      if (
        !existing.some(
          (row) => row.anchor?.idempotencyKey === key,
        )
      ) {
        await addFeedback({
          campaignItemId: payload.campaignItemId,
          authorKind: "client",
          authorId: payload.portalUserId,
          clientId: payload.clientId,
          body: payload.feedback,
          anchor: { idempotencyKey: key, kind: CAMPAIGN_DECISION_EVENT },
        });
      }
      feedbackRecorded = true;
    }
    await notifyStaffOfCampaignDecision({
      clientId: payload.clientId,
      campaignItemId: payload.campaignItemId,
      title: payload.title,
      action: payload.action === "approved" ? "approve" : "reject",
      feedback: payload.feedback ?? undefined,
    });
    event.applied = true;
    event.result = {
      auditId: payload.auditId,
      feedbackRecorded,
      notificationAttempted: true,
    };
    return true;
  });
}

async function reconcileDbCampaignDecision(
  db: Db,
  campaignItemId: string,
  hook?: EmitHook,
): Promise<boolean> {
  const key = campaignDecisionKey(campaignItemId);
  if (hook) {
    const preview = await db.execute<DecisionOutboxRow>(sql`
      select event_id as "eventId", payload, result, applied
      from public.seam_outbox
      where idempotency_key = ${key}
      limit 1
    `);
    if (preview[0] && !preview[0].applied) {
      await hook({
        name: CAMPAIGN_DECISION_EVENT,
        payload: preview[0].payload ?? {},
      });
    }
  }

  const projected = await db.transaction(async (tx) => {
    const intents = await tx.execute<DecisionOutboxRow>(sql`
      select event_id as "eventId", payload, result, applied
      from public.seam_outbox
      where idempotency_key = ${key}
      limit 1
      for update
    `);
    const intent = intents[0];
    if (!intent) throw new Error("CAMPAIGN_DECISION_INTENT_MISSING");
    const payload = parseCampaignDecisionPayload(intent.payload);
    if (!payload) throw new Error("CAMPAIGN_DECISION_INTENT_INVALID");
    if (intent.applied) return { appliedNow: false, payload };

    let feedbackId: string | null = null;
    if (payload.action === "rejected" && payload.feedback) {
      const feedbackRows = await tx.execute<{ id: string }>(sql`
        insert into public.portal_feedback (
          campaign_item_id,
          author_kind,
          author_id,
          client_id,
          body,
          anchor
        ) values (
          ${payload.campaignItemId}::uuid,
          'client',
          ${payload.portalUserId}::uuid,
          ${payload.clientId}::uuid,
          ${payload.feedback},
          ${JSON.stringify({ idempotencyKey: key, kind: CAMPAIGN_DECISION_EVENT })}::jsonb
        )
        returning portal_feedback_id as id
      `);
      feedbackId = feedbackRows[0]?.id ?? null;
    }

    const leads = await tx.execute<{ employeeId: string }>(sql`
      select employee_id as "employeeId"
      from public.account_team_member
      where client_id = ${payload.clientId}::uuid
        and is_account_lead = true
      order by created_at asc
      limit 1
    `);
    const staff = leads[0]
      ? leads
      : await tx.execute<{ employeeId: string }>(sql`
          select employee_id as "employeeId"
          from public.employee
          where is_active = true
          order by created_at asc
          limit 1
        `);
    const employeeId = staff[0]?.employeeId ?? null;
    let notificationId: string | null = null;
    if (employeeId) {
      const copy = campaignDecisionNotificationCopy(payload);
      const notifications = await tx.execute<{ id: string }>(sql`
        insert into public.os_notification (
          employee_id,
          title,
          body,
          kind,
          href,
          entity_type,
          entity_id
        ) values (
          ${employeeId}::uuid,
          ${copy.title},
          ${copy.body},
          'campaign',
          ${copy.href},
          'campaign_item',
          ${payload.campaignItemId}::uuid
        )
        returning os_notification_id as id
      `);
      notificationId = notifications[0]?.id ?? null;
    }

    const result = {
      auditId: payload.auditId,
      feedbackId,
      notificationId,
    };
    await tx.execute(sql`
      update public.seam_outbox
      set result = ${JSON.stringify(result)}::jsonb,
          applied = true
      where event_id = ${intent.eventId}::uuid
        and applied = false
    `);
    return { appliedNow: true, payload };
  });

  if (projected.appliedNow) {
    const { persistMemoryChunk } = await import("../ai/memory-db");
    await persistMemoryChunk({
      sourceType: "feedback",
      sourceId: projected.payload.campaignItemId,
      content: `Portal campaign ${projected.payload.action}: client decision recorded for "${projected.payload.title}".${
        projected.payload.feedback
          ? ` Feedback: ${projected.payload.feedback}`
          : ""
      }`,
      metadata: {
        clientId: projected.payload.clientId,
        campaignItemId: projected.payload.campaignItemId,
        kind: `portal.campaign.${projected.payload.action}`,
        auditId: projected.payload.auditId,
      },
    }).catch(() => undefined);
  }
  return true;
}

/**
 * Client-side portal decision. New decisions use one locked transaction for
 * authority, state, portal-attributed audit, and durable projection intent.
 * Same-action retries reconcile the existing intent without duplicating the
 * decision; opposite actions or changed rejection feedback conflict.
 */
export async function decidePortalItem(opts: {
  actor: PortalApprovalActor;
  clientId: string;
  id: string;
  to: CampaignDecisionAction;
  feedback?: string;
  /** Test-only injectable audit for the in-memory transaction simulation. */
  audit?: AuditWriter;
  /** Post-commit projector hook used by deterministic failure tests. */
  emit?: EmitHook;
}): Promise<GateOutcome> {
  requirePortalApprovalActor({ actor: opts.actor, clientId: opts.clientId });
  const feedback = normalizeDecisionFeedback(opts.to, opts.feedback);
  if (opts.to === "rejected" && !feedback) {
    return { ok: false, reason: "FEEDBACK_REQUIRED", code: "FEEDBACK_REQUIRED" };
  }
  const db = getDb();
  const result = db
    ? await decidePortalItemDb(db, { ...opts, feedback })
    : await decidePortalItemMemory({ ...opts, feedback });
  if (!result.ok) return result;

  let reconciled = false;
  try {
    reconciled = db
      ? await reconcileDbCampaignDecision(db, opts.id, opts.emit)
      : await reconcileMemoryCampaignDecision(opts.id, opts.emit);
  } catch {
    // State, audit, and the pending intent are already durable. An exact
    // same-action replay re-enters this reconciler; opposite actions conflict.
  }
  return { ...result, reconciled };
}

async function resolveStaffForCampaignClient(
  clientId: string,
): Promise<string | null> {
  const { getDb } = await import("../db");
  const db = getDb();
  if (!db) {
    const { DEMO_STAFF_LEAD_ID } = await import("../demo-store");
    return DEMO_STAFF_LEAD_ID;
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
    href: `/approvals?id=${encodeURIComponent(input.campaignItemId)}`,
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
