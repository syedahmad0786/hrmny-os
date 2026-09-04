import type { RunAgent } from "./agent-run";
import {
  completeIntegrationReceipt,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
  updateIntegrationReceiptProgress,
} from "../integrations/inbox";
import { emitHealthSignal } from "../m1-persistence";
import { draftEmailFollowup, listEmailFollowups } from "../trpc/leadgen-router";

export async function runDueFollowupDrafts(input?: {
  now?: Date;
  limit?: number;
  runAgent?: RunAgent;
}) {
  const now = input?.now ?? new Date();
  const due = (await listEmailFollowups(now))
    .filter((item) => item.state === "due" && item.nextTouch)
    .slice(0, Math.min(50, Math.max(1, input?.limit ?? 20)));
  let drafted = 0;
  let replayed = 0;
  let failed = 0;

  for (const item of due) {
    const externalEventId = `followup-draft:${item.sourceId}:${item.nextTouch}`;
    const payload = {
      sourceId: item.sourceId,
      dealId: item.dealId,
      nextTouch: item.nextTouch,
      dueAt: item.dueAt,
    };
    const receipt = await recordIntegrationReceipt({
      provider: "hrmny",
      externalEventId,
      operation: "sales.followup.draft",
      rawBody: JSON.stringify(payload),
      payload,
      status: "processing",
      result: { bridgeStatus: "drafting" },
    });
    if (receipt.duplicate && receipt.status === "completed") {
      replayed += 1;
      continue;
    }
    let claimed = !receipt.duplicate;
    if (receipt.duplicate && receipt.status === "failed") {
      claimed = await transitionIntegrationReceiptProgress(
        receipt.receiptId,
        { status: "failed", stateVersion: receipt.stateVersion },
        { status: "processing", result: { bridgeStatus: "drafting" } },
      );
    }
    if (!claimed) {
      replayed += 1;
      continue;
    }
    try {
      const draft = await draftEmailFollowup({
        id: item.sourceId,
        now,
        runAgent: input?.runAgent,
      });
      await completeIntegrationReceipt(receipt.receiptId, {
        bridgeStatus: "draft_ready_for_human_review",
        outreachItemId: draft.id,
        sourceId: item.sourceId,
        cadenceTouch: draft.cadenceTouch,
      });
      drafted += 1;
    } catch (error) {
      failed += 1;
      await updateIntegrationReceiptProgress(receipt.receiptId, {
        status: "failed",
        result: { bridgeStatus: "draft_failed", ...payload },
        lastError:
          error instanceof Error ? error.message : "Follow-up draft failed",
      }).catch(() => undefined);
    }
  }

  const result = { considered: due.length, drafted, replayed, failed };
  if (due.length || failed) {
    await emitHealthSignal(
      "sales_followup_draft_scheduler",
      failed ? "warn" : "info",
      result,
    ).catch(() => undefined);
  }
  return result;
}
