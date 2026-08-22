/**
 * Shared OS outreach approve (draft → approved). Used by agent
 * `outreach.os_approve`. Does not send — Gmail HITL send stays separate.
 */
import type { ActorContext } from "@hrmny/gate";
import { approveOutreach } from "../trpc/leadgen-router";
import { getOutreach } from "./store";

export type OsOutreachActor = {
  employeeId: string;
  roles?: string[];
  permissions?: string[];
};

export type OsOutreachApproveResult = {
  ok: boolean;
  reason?: string;
  outreach: {
    id: string;
    state: string;
    dealId: string;
    subject: string | null;
  } | null;
};

function actorFrom(input: OsOutreachActor): ActorContext {
  return {
    employeeId: input.employeeId,
    roles: input.roles?.length ? input.roles : ["partner", "am"],
    permissions: input.permissions ?? [],
  };
}

export async function approveOsOutreach(input: {
  outreachId: string;
  actor: OsOutreachActor;
}): Promise<OsOutreachApproveResult> {
  const item = await getOutreach(input.outreachId);
  if (!item) {
    return { ok: false, reason: "NOT_FOUND", outreach: null };
  }
  const result = await approveOutreach({
    id: input.outreachId,
    actor: actorFrom(input.actor),
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.blockedBy?.[0]?.reason ?? "GATE_BLOCKED",
      outreach: {
        id: item.id,
        state: item.state,
        dealId: item.dealId,
        subject: item.subject,
      },
    };
  }
  const next = await getOutreach(input.outreachId);
  return {
    ok: true,
    outreach: next
      ? {
          id: next.id,
          state: next.state,
          dealId: next.dealId,
          subject: next.subject,
        }
      : {
          id: item.id,
          state: "approved",
          dealId: item.dealId,
          subject: item.subject,
        },
  };
}

/** Parse outreach UUID from agent/chat prompts. */
export function parseOutreachIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /outreach(?:Id)?\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1].toLowerCase();
  const bare = prompt.match(
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  );
  return bare?.[1]?.toLowerCase() ?? null;
}
