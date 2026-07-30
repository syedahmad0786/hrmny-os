import { z } from "zod";
import { AgentIdSchema, type AgentId } from "./agents/registry";

/**
 * AI autonomy governance (Phase 6). Default is `manual`: agents only run when a
 * human triggers them. `scheduled_research` is an opt-in, audited mode where
 * allow-listed agents may run unattended — but ONLY to research/draft/classify.
 * No scheduled run may ever send, publish, post, approve, spend, or mutate a
 * business record; those cross the gate/HITL seam with a human, never a cron.
 *
 * Persisted as a `convention` row (rule key "ai.autonomy_policy"); read the same
 * way llm.spend_cap is read in root.ts adminRouter.health.
 */

export type AutonomyMode = "manual" | "scheduled_research";
export const AutonomyModeSchema = z.enum(["manual", "scheduled_research"]);

/** Actions a scheduled run may attempt — internal-only vs external side effect. */
export const SCHEDULED_ALLOWED_ACTIONS = ["research", "draft", "classify"] as const;
export const SCHEDULED_FORBIDDEN_ACTIONS = [
  "send",
  "publish",
  "post",
  "approve",
  "spend",
  "mutate_business_record",
] as const;

export type ScheduledAllowedAction = (typeof SCHEDULED_ALLOWED_ACTIONS)[number];
export type ScheduledForbiddenAction =
  (typeof SCHEDULED_FORBIDDEN_ACTIONS)[number];
export type ScheduledAction = ScheduledAllowedAction | ScheduledForbiddenAction;

const ALLOWED = new Set<string>(SCHEDULED_ALLOWED_ACTIONS);

export const AutonomyPolicySchema = z.object({
  mode: AutonomyModeSchema,
  allowedScheduledAgents: z.array(AgentIdSchema),
  updatedBy: z.string().nullable(),
  /** ISO timestamp. */
  updatedAt: z.string(),
});
export type AutonomyPolicy = z.infer<typeof AutonomyPolicySchema>;

/** Fail-closed default: no unattended activity until a human opts in. */
export function defaultAutonomyPolicy(): AutonomyPolicy {
  return {
    mode: "manual",
    allowedScheduledAgents: [],
    updatedBy: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Parse a stored `convention.payload` into a policy. Anything invalid falls back
 * to the manual default — a corrupt row must never grant scheduled autonomy.
 */
export function parseAutonomyPolicy(payload: unknown): AutonomyPolicy {
  const parsed = AutonomyPolicySchema.safeParse(payload);
  return parsed.success ? parsed.data : defaultAutonomyPolicy();
}

export type PolicyViolationReason =
  | "forbidden_action"
  | "mode_not_scheduled"
  | "agent_not_allowlisted";

export class PolicyViolationError extends Error {
  readonly code = "policy_violation" as const;
  constructor(
    readonly agent: AgentId,
    readonly action: ScheduledAction,
    readonly violation: PolicyViolationReason,
  ) {
    super(
      `Scheduled run refused for agent "${agent}" action "${action}": ${violation}.`,
    );
    this.name = "PolicyViolationError";
  }
}

/**
 * Pure guard: throws PolicyViolationError unless `agent` may perform `action`
 * unattended under `policy`. Precedence is deliberate and fail-closed:
 *   1. only research/draft/classify are ever permitted — every forbidden action
 *      (and any unknown one) throws regardless of mode;
 *   2. manual mode allows no scheduled autonomy at all;
 *   3. the agent must be explicitly allow-listed for scheduled runs.
 */
export function assertScheduledAllowed(
  policy: AutonomyPolicy,
  agent: AgentId,
  action: ScheduledAction,
): void {
  if (!ALLOWED.has(action)) {
    throw new PolicyViolationError(agent, action, "forbidden_action");
  }
  if (policy.mode !== "scheduled_research") {
    throw new PolicyViolationError(agent, action, "mode_not_scheduled");
  }
  if (!policy.allowedScheduledAgents.includes(agent)) {
    throw new PolicyViolationError(agent, action, "agent_not_allowlisted");
  }
}

export type PolicyRefusal = {
  ok: false;
  refused: true;
  agentId: AgentId;
  reason: "policy_violation";
  violation: PolicyViolationReason;
  action: ScheduledAction;
  message: string;
};

/** Typed refusal for a blocked scheduled run — mirrors agentDisabledRefusal. */
export function policyViolationRefusal(err: PolicyViolationError): PolicyRefusal {
  return {
    ok: false,
    refused: true,
    agentId: err.agent,
    reason: "policy_violation",
    violation: err.violation,
    action: err.action,
    message: err.message,
  };
}
