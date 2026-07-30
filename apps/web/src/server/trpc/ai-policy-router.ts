import { z } from "zod";
import { and, auditEvent, convention, desc, eq } from "@hrmny/db";
import {
  AgentIdSchema,
  AutonomyModeSchema,
  defaultAutonomyPolicy,
  parseAutonomyPolicy,
  type AutonomyPolicy,
} from "@hrmny/ai";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { requirePermission, router, staffProcedure } from "./trpc";

/**
 * AI autonomy governance surface. The policy lives in a `convention` row
 * (rule key "ai.autonomy_policy") and is read the same way llm.spend_cap is in
 * adminRouter.health; change history comes from the append-only audit_event log.
 *
 * Module only — the orchestrator registers this on appRouter (see PR notes).
 */

const RULE_KEY = "ai.autonomy_policy";
const AUDIT_ENTITY = "ai_policy";
const AUDIT_ACTION = "ai.policy.updated";

async function readPolicy(): Promise<AutonomyPolicy> {
  const db = getDb();
  if (!db) {
    const row = getDemoStore().conventions.get(RULE_KEY);
    return row ? parseAutonomyPolicy(row.payload) : defaultAutonomyPolicy();
  }
  const [row] = await db
    .select({ payload: convention.payload })
    .from(convention)
    .where(and(eq(convention.ruleKey, RULE_KEY), eq(convention.isActive, true)))
    .limit(1);
  return row ? parseAutonomyPolicy(row.payload) : defaultAutonomyPolicy();
}

export const aiPolicyRouter = router({
  /** Current effective autonomy policy (manual default if never set). */
  get: staffProcedure.query(() => readPolicy()),

  /** Replace the policy. New convention version + audited before/after. */
  set: staffProcedure
    .use(requirePermission(AUDIT_ENTITY, "admin"))
    .input(
      z.object({
        mode: AutonomyModeSchema,
        allowedScheduledAgents: z.array(AgentIdSchema).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const policy: AutonomyPolicy = {
        mode: input.mode,
        allowedScheduledAgents: input.allowedScheduledAgents,
        updatedBy: ctx.employeeId,
        updatedAt: new Date().toISOString(),
      };
      const db = getDb();
      if (!db) {
        const store = getDemoStore();
        const prev = store.conventions.get(RULE_KEY);
        store.conventions.set(RULE_KEY, {
          ruleKey: RULE_KEY,
          version: (prev?.version ?? 0) + 1,
          payload: policy,
          updatedAt: policy.updatedAt,
          updatedByEmployeeId: ctx.employeeId,
        });
        store.appendAudit({
          actorEmployeeId: ctx.employeeId!,
          action: AUDIT_ACTION,
          entityType: AUDIT_ENTITY,
          entityId: "00000000-0000-4000-8000-000000000000",
          before: prev ? { ...prev.payload } : null,
          after: { ...policy },
          reason: null,
        });
        return policy;
      }
      return db.transaction(async (tx) => {
        const [previous] = await tx
          .select()
          .from(convention)
          .where(eq(convention.ruleKey, RULE_KEY))
          .orderBy(desc(convention.version))
          .limit(1);
        await tx
          .update(convention)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(eq(convention.ruleKey, RULE_KEY), eq(convention.isActive, true)),
          );
        const [next] = await tx
          .insert(convention)
          .values({
            ruleKey: RULE_KEY,
            version: String(Number(previous?.version ?? 0) + 1),
            payload: policy,
          })
          .returning();
        await tx.insert(auditEvent).values({
          actorEmployeeId: ctx.employeeId,
          action: AUDIT_ACTION,
          entityType: AUDIT_ENTITY,
          entityId: next!.conventionId,
          before: previous ? { ...(previous.payload as object) } : null,
          after: { ...policy },
          reason: null,
        });
        return policy;
      });
    }),

  /** Policy change history, newest first, from the audit log. */
  history: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }))
    .query(async ({ input }) => {
      const db = getDb();
      if (!db) {
        return getDemoStore()
          .audits.filter((a) => a.entityType === AUDIT_ENTITY)
          .slice(0, input.limit)
          .map((a) => ({
            action: a.action,
            actorEmployeeId: a.actorEmployeeId,
            before: a.before,
            after: a.after,
            createdAt: a.createdAt,
          }));
      }
      const rows = await db
        .select({
          action: auditEvent.action,
          actorEmployeeId: auditEvent.actorEmployeeId,
          before: auditEvent.before,
          after: auditEvent.after,
          createdAt: auditEvent.createdAt,
        })
        .from(auditEvent)
        .where(eq(auditEvent.entityType, AUDIT_ENTITY))
        .orderBy(desc(auditEvent.createdAt))
        .limit(input.limit);
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
    }),
});
