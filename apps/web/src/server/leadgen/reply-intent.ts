import type { ReplyIntent } from "@hrmny/ai";
import { activity, and, auditEvent, deal as dealTable, eq } from "@hrmny/db";
import {
  bootstrapGateRegistry,
  transition,
  type AuditWriter,
} from "@hrmny/gate";
import {
  getContact as repoGetContact,
  getDeal as repoGetDeal,
  moveDealStage as repoMoveDealStage,
} from "../crm/repository";
import { writeAudit } from "../m1-persistence";
import { getDb } from "../db";
import { outreachVoiceViolations } from "../sales-os/compliance";
import { listOutreach as repoListOutreach } from "./store";

/**
 * Reply-intent → deal-stage hook (M8). M7 classifies the reply into a
 * `ReplyIntent`; this maps it to a target pipeline stage and applies it via
 * `moveDealStage`. Positive intents advance the deal; passive intents don't move.
 *
 * ponytail: the stage ids are a calibration knob — tune against real
 * `pipelineStages()` values. Note this schema has NO lost/disqualified *stage*:
 * "lost" is a `close_outcome_enum` value, not a CRM pipeline stage, and the
 * consumable surface only exposes `moveDealStage` (stages only). So `unsubscribe`
 * records no stage move here — wire it to `closeOutcome:"lost"` once `updateDeal`
 * is in the consumable set or a `disqualified` stage is added.
 */
export const intentToTransition: Record<ReplyIntent, string | null> = {
  interested: "scope",
  question: "scope",
  not_now: null,
  other: null,
  unsubscribe: null,
};

export type MoveDealStage = (input: {
  dealId: string;
  to: string;
  actorEmployeeId?: string | null;
}) => Promise<{ ok: true; deal: unknown } | { ok: false; reason: string }>;

export type ApplyReplyIntentResult = {
  intent: ReplyIntent;
  toStage: string | null;
  moved: boolean;
  reason?: string;
};

type ReplyStageGateDeps = {
  getDeal: typeof repoGetDeal;
  getContact: typeof repoGetContact;
  listOutreach: typeof repoListOutreach;
  moveDealStage: MoveDealStage;
  audit: AuditWriter;
  moveAndAudit?: typeof moveAndAuditReplyStage;
};

const SYSTEM_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000000";

async function moveAndAuditReplyStage(input: {
  existing: Awaited<ReturnType<typeof repoGetDeal>> & object;
  to: string;
  gateData: Record<string, unknown>;
  actorEmployeeId?: string | null;
}): Promise<{ deal: object; auditId: string } | null> {
  const db = getDb();
  if (!db) return null;
  const now = new Date();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(dealTable)
      .set({
        stage: input.to as typeof dealTable.$inferInsert.stage,
        updatedAt: now,
      })
      .where(
        and(
          eq(dealTable.dealId, input.existing.dealId),
          eq(
            dealTable.stage,
            input.existing.stage as typeof dealTable.$inferSelect.stage,
          ),
        ),
      )
      .returning({ dealId: dealTable.dealId });
    if (!updated)
      throw new Error("Reply stage changed before it could be applied");

    await tx.insert(activity).values({
      type: "stage_change",
      subject: `Stage ${input.existing.stage} → ${input.to}`,
      dealId: input.existing.dealId,
      companyId: input.existing.companyId,
      actorEmployeeId: input.actorEmployeeId ?? null,
      metadata: { from: input.existing.stage, to: input.to },
    });
    const [audit] = await tx
      .insert(auditEvent)
      .values({
        actorEmployeeId: input.actorEmployeeId ?? null,
        action: "deal.transition",
        entityType: "deal",
        entityId: input.existing.dealId,
        before: { ...input.gateData, state: input.existing.stage },
        after: { ...input.gateData, stage: input.to, state: input.to },
        reason: "Inbound reply advanced the deal through Sales gates",
      })
      .returning({ auditId: auditEvent.auditEventId });
    if (!audit) throw new Error("Reply transition audit insert failed");
    return {
      deal: {
        ...input.existing,
        stage: input.to,
        updatedAt: now.toISOString(),
      },
      auditId: audit.auditId,
    };
  });
}

const defaultAudit: AuditWriter = async (event) => {
  const row = await writeAudit({
    actorEmployeeId:
      event.actorEmployeeId === SYSTEM_EMPLOYEE_ID
        ? null
        : event.actorEmployeeId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    before: event.before,
    after: event.after,
    reason: event.reason ?? null,
  });
  return { auditId: row.auditEventId };
};

/** Apply an inbound-reply stage move through the same deal gates as the CRM UI. */
export async function moveReplyDealStageThroughGates(
  input: {
    dealId: string;
    to: string;
    actorEmployeeId?: string | null;
  },
  deps: ReplyStageGateDeps = {
    getDeal: repoGetDeal,
    getContact: repoGetContact,
    listOutreach: repoListOutreach,
    moveDealStage: repoMoveDealStage,
    audit: defaultAudit,
    moveAndAudit: moveAndAuditReplyStage,
  },
): Promise<{ ok: true; deal: unknown } | { ok: false; reason: string }> {
  bootstrapGateRegistry();
  const existing = await deps.getDeal(input.dealId);
  if (!existing) return { ok: false, reason: "Deal not found" };

  const contact = existing.primaryContactId
    ? await deps.getContact(existing.primaryContactId)
    : null;
  const sent = (await deps.listOutreach({ dealId: existing.dealId })).filter(
    (item) => item.state === "sent",
  );
  const voiceCheckPassed = sent.some(
    (item) =>
      outreachVoiceViolations(item.body, existing.companyName).length === 0,
  );
  const gateData = {
    ...existing,
    emailVerified: Boolean(contact?.emailVerified),
    voiceCheckPassed,
  };
  let appliedAuditId: string | null = null;

  const result = await transition(
    {
      employeeId: input.actorEmployeeId ?? SYSTEM_EMPLOYEE_ID,
      roles: ["system"],
      permissions: [],
    },
    {
      entityType: "deal",
      entityId: existing.dealId,
      state: existing.stage,
      data: gateData,
    },
    { to: input.to, from: existing.stage },
    {
      authorize: async (actor) => actor.roles.includes("system"),
      apply: async ({ request }) => {
        const atomic = deps.moveAndAudit
          ? await deps.moveAndAudit({
              existing,
              to: request.to,
              gateData,
              actorEmployeeId: input.actorEmployeeId,
            })
          : null;
        if (atomic) {
          appliedAuditId = atomic.auditId;
          return {
            entityType: "deal",
            entityId: existing.dealId,
            state: request.to,
            data: { ...gateData, stage: request.to },
          };
        }
        const moved = await deps.moveDealStage({
          dealId: existing.dealId,
          to: request.to,
          actorEmployeeId: input.actorEmployeeId,
        });
        if (!moved.ok) throw new Error(moved.reason);
        return {
          entityType: "deal",
          entityId: existing.dealId,
          state: request.to,
          data: { ...gateData, stage: request.to },
        };
      },
      audit: async (event) =>
        appliedAuditId ? { auditId: appliedAuditId } : deps.audit(event),
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      reason:
        result.blockedBy?.map((block) => block.reason).join("; ") ??
        result.code,
    };
  }
  return { ok: true, deal: { ...existing, stage: result.newState } };
}

export async function applyReplyIntent(input: {
  dealId: string;
  intent: ReplyIntent;
  actorEmployeeId?: string | null;
  /** Injectable for tests; defaults to the CRM repository. */
  moveDealStage?: MoveDealStage;
}): Promise<ApplyReplyIntentResult> {
  const toStage = intentToTransition[input.intent];
  if (toStage === null) {
    if (input.intent === "unsubscribe") {
      const { honorUnsubscribe } = await import("../sales-os/replies");
      await honorUnsubscribe({
        dealId: input.dealId,
        source: "reply-intent",
      });
      return {
        intent: input.intent,
        toStage: null,
        moved: false,
        reason: "suppressed_and_closed",
      };
    }
    return { intent: input.intent, toStage: null, moved: false };
  }
  const move = input.moveDealStage ?? moveReplyDealStageThroughGates;
  const res = await move({
    dealId: input.dealId,
    to: toStage,
    actorEmployeeId: input.actorEmployeeId,
  });
  return {
    intent: input.intent,
    toStage,
    moved: res.ok,
    reason: res.ok ? undefined : res.reason,
  };
}
