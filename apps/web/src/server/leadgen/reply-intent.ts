import type { ReplyIntent } from "@hrmny/ai";
import { moveDealStage as repoMoveDealStage } from "../crm/repository";

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
  interested: "engage",
  question: "engage",
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

export async function applyReplyIntent(input: {
  dealId: string;
  intent: ReplyIntent;
  actorEmployeeId?: string | null;
  /** Injectable for tests; defaults to the CRM repository. */
  moveDealStage?: MoveDealStage;
}): Promise<ApplyReplyIntentResult> {
  const toStage = intentToTransition[input.intent];
  if (toStage === null) {
    return { intent: input.intent, toStage: null, moved: false };
  }
  const move = input.moveDealStage ?? repoMoveDealStage;
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
