import { TRPCError } from "@trpc/server";
import { hashIntegrationPayload } from "../integrations/inbox";
import type { OutreachItem } from "./store";

export function outreachSnapshotHash(item: OutreachItem): string {
  return hashIntegrationPayload(
    JSON.stringify([
      item.id,
      item.dealId,
      item.channel,
      item.state,
      item.recipient,
      item.subject,
      item.body,
      item.contactId,
      item.linkedinUrl,
      item.approvedBy,
      item.cadenceTouch,
      item.updatedAt,
    ]),
  );
}

export function assertOutreachSnapshot(
  item: OutreachItem,
  expected?: string,
): void {
  if (expected !== undefined && outreachSnapshotHash(item) !== expected) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This draft changed. Reload and review it again; nothing was sent.",
    });
  }
}
