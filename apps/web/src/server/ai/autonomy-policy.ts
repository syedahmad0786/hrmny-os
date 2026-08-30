import { and, convention, eq } from "@hrmny/db";
import {
  defaultAutonomyPolicy,
  parseAutonomyPolicy,
  type AutonomyPolicy,
} from "@hrmny/ai";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";

/** One canonical rule key for every reader and writer of the AI autonomy policy. */
export const AI_AUTONOMY_RULE_KEY = "ai.autonomy_policy";

/** Exactly one active row is required; ambiguity can never grant autonomy. */
export function resolveAiAutonomyPolicy(
  activePayloads: readonly unknown[],
): AutonomyPolicy {
  return activePayloads.length === 1
    ? parseAutonomyPolicy(activePayloads[0])
    : defaultAutonomyPolicy();
}

/**
 * Read the effective autonomy policy without changing it. Invalid or missing
 * state is deliberately interpreted as manual mode by parseAutonomyPolicy.
 */
export async function readAiAutonomyPolicy(): Promise<AutonomyPolicy> {
  const db = getDb();
  if (!db) {
    const row = getDemoStore().conventions.get(AI_AUTONOMY_RULE_KEY);
    return resolveAiAutonomyPolicy(row ? [row.payload] : []);
  }

  const rows = await db
    .select({ payload: convention.payload })
    .from(convention)
    .where(
      and(
        eq(convention.ruleKey, AI_AUTONOMY_RULE_KEY),
        eq(convention.isActive, true),
      ),
    )
    .limit(2);
  return resolveAiAutonomyPolicy(rows.map((row) => row.payload));
}
