import { listOutreach, patchOutreach } from "../leadgen/store";
import { isEmailChannel, suppressTarget, domainOf } from "./compliance";
import { recordEmailEvent } from "./store";

const SEVEN_DAYS_MS = 7 * 86_400_000;

export async function flagStaleEmails(now = new Date()): Promise<number> {
  const sent = (await listOutreach({ state: "sent" })).filter((o) =>
    isEmailChannel(o.channel),
  );
  let flagged = 0;
  for (const item of sent) {
    if (!item.sentAt) continue;
    if (now.getTime() - new Date(item.sentAt).getTime() < SEVEN_DAYS_MS)
      continue;
    if (item.reworkFeedback === "no_response") continue;
    await patchOutreach(item.id, { reworkFeedback: "no_response" });
    flagged += 1;
  }
  return flagged;
}

export async function recordBounce(input: {
  outreachItemId: string;
  email?: string | null;
}) {
  if (input.email) {
    await suppressTarget({
      email: input.email,
      domain: domainOf(input.email),
      reason: "bounce",
      source: "gmail",
    });
  }
  await recordEmailEvent({
    outreachItemId: input.outreachItemId,
    kind: "bounced",
    provider: "gmail",
    payload: { email: input.email ?? null },
  });
  await patchOutreach(input.outreachItemId, { reworkFeedback: "bounced" });
}
