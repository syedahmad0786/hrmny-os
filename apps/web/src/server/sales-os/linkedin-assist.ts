import { linkedinProfileUrl } from "@/lib/linkedin-profile";
import { getOutreach, listOutreach, patchOutreach } from "../leadgen/store";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  recordIntegrationReceipt,
  getIntegrationReceipt,
} from "../integrations/inbox";
import { addCredit } from "./store";
import { assertLinkedInAssistAllowed, weekKey } from "./compliance";

export async function recordManualLinkedInSend(
  id: string,
  actorEmployeeId: string,
) {
  const item = await getOutreach(id);
  if (!item || !item.channel.startsWith("linkedin"))
    throw new Error("LinkedIn draft not found");
  const prior = await getIntegrationReceipt("linkedin-manual", id);
  if (prior) {
    if (prior.ownerEmployeeId !== actorEmployeeId)
      throw new Error("This LinkedIn outcome belongs to another employee");
    if (prior.status === "completed") return item;
    throw new Error(
      "This manual outcome needs reconciliation; it has already been recorded",
    );
  }
  if (item.state !== "approved") throw new Error("Approve the draft first");
  if (!linkedinProfileUrl(item.linkedinUrl ?? item.recipient))
    throw new Error(
      "Add a valid LinkedIn public profile URL before recording the send",
    );
  if (item.channel === "linkedin_followup") {
    const connect = (await listOutreach({ dealId: item.dealId })).find(
      (row) =>
        row.channel === "linkedin_connect" &&
        row.contactId === item.contactId &&
        row.acceptedAt,
    );
    if (!connect)
      throw new Error("Record the connection acceptance before the follow-up");
    const connectionReceipt = await getIntegrationReceipt(
      "linkedin-manual",
      connect.id,
    );
    if (connectionReceipt?.ownerEmployeeId !== actorEmployeeId)
      throw new Error("Use the employee who sent the connection request");
  }
  const cap = await assertLinkedInAssistAllowed();
  if (!cap.ok) throw new Error(cap.reason);
  const receipt = await recordIntegrationReceipt({
    provider: "linkedin-manual",
    externalEventId: id,
    operation: "linkedin.manual.sent",
    rawBody: JSON.stringify({ id, actorEmployeeId }),
    payload: {
      id,
      actorEmployeeId,
      evidence: "employee_reported",
      providerVerified: false,
    },
    status: "processing",
    ownerEmployeeId: actorEmployeeId,
  });
  if (receipt.duplicate)
    throw new Error("Manual send is already being recorded");
  try {
    await addCredit("linkedin_assist", 1, weekKey());
    const updated = await patchOutreach(id, {
      state: "sent",
      sentAt: new Date().toISOString(),
    });
    await completeIntegrationReceipt(receipt.receiptId, {
      id,
      providerVerified: false,
      recordedBy: actorEmployeeId,
    });
    return updated;
  } catch (error) {
    await failIntegrationReceipt(
      receipt.receiptId,
      "Manual outcome recording interrupted; reconcile before retrying",
    );
    throw error;
  }
}

export async function recordLinkedInAcceptance(
  id: string,
  actorEmployeeId: string,
) {
  const item = await getOutreach(id);
  const receipt = await getIntegrationReceipt("linkedin-manual", id);
  if (
    !item ||
    item.channel !== "linkedin_connect" ||
    item.state !== "sent" ||
    receipt?.ownerEmployeeId !== actorEmployeeId ||
    receipt.status !== "completed"
  )
    throw new Error(
      "Record your sent connection request before recording acceptance",
    );
  return item.acceptedAt
    ? item
    : patchOutreach(id, { acceptedAt: new Date().toISOString() });
}
