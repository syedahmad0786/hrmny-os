import { getDeal } from "../crm/repository";
import { defaultRunAgent, type RunAgent } from "../leadgen/agent-run";
import { insertOutreach, listOutreach } from "../leadgen/store";
import {
  buildComplianceFooter,
  buildUnsubscribeUrl,
  ensureFooter,
} from "./compliance";
import { getContactResearch, getSalesOsSettings, isSuppressed } from "./store";

export function failsSpecificityTest(
  body: string,
  companyName: string,
): boolean {
  const other = "Acme Placeholder Group";
  if (!companyName.trim()) return true;
  if (!body.toLowerCase().includes(companyName.toLowerCase())) return true;
  const swapped = body.replace(new RegExp(companyName, "gi"), other);
  return swapped === body;
}

export async function draftChannelsForApprovedContact(
  contactResearchId: string,
  deps: { runAgent?: RunAgent; roles?: string[] } = {},
) {
  const research = await getContactResearch(contactResearchId);
  if (!research) throw new Error("Contact research not found");
  if (research.approvalState !== "approved" || !research.dealId) {
    throw new Error("Gate 2 must approve the contact before drafting");
  }
  const settings = await getSalesOsSettings();
  const deal = await getDeal(research.dealId);
  if (!deal) throw new Error("Deal missing for approved contact");
  const suppressed = research.email
    ? await isSuppressed({ email: research.email })
    : null;
  const canEmail =
    Boolean(research.email) && research.emailVerified && !suppressed;
  const active = (await listOutreach({ dealId: research.dealId })).filter(
    (item) =>
      item.contactId === research.contactId && item.state !== "discarded",
  );
  const existing = (channel: string) =>
    active.find((item) => item.channel === channel && item.cadenceTouch === 1);
  const footer = buildComplianceFooter({
    senderName: settings.outreach.senderName,
    senderTitle: settings.outreach.senderTitle,
    physicalAddress: settings.outreach.physicalAddress,
    unsubscribeUrl: research.email
      ? buildUnsubscribeUrl(settings.outreach.unsubscribePath, research.email)
      : undefined,
  });

  const first = research.fullName.split(" ")[0] ?? "there";
  const connect =
    `Hi ${first} — following ${deal.companyName}'s UAE work from hrmny. Would be glad to connect.`.slice(
      0,
      settings.outreach.linkedinConnectMaxChars,
    );
  const followup = `Hi ${first}, thanks for connecting. We help brands like ${deal.companyName} land launches in the UAE — open to a short call this week?`;

  const created = [];
  if (canEmail && !existing("gmail")) {
    const run = await (deps.runAgent ?? defaultRunAgent)({
      agent: "outreach-draft",
      roles: deps.roles,
      input: {
        company: deal.companyName,
        contact: research.fullName,
        whyThis: research.title,
        sopVoice: settings.outreach.voice,
      },
    });
    if (
      run.output &&
      typeof run.output === "object" &&
      "refused" in run.output &&
      run.output.refused === true
    ) {
      throw new Error(
        typeof run.output.message === "string"
          ? run.output.message
          : "Outreach drafting is disabled by policy",
      );
    }
    const out =
      run.output && typeof run.output === "object"
        ? (run.output as Record<string, unknown>)
        : {};
    let emailBody =
      typeof out.body === "string"
        ? out.body.trim()
        : typeof run.output === "string"
          ? run.output.trim()
          : "";
    if (!emailBody) throw new Error("Drafting provider returned no message");
    if (
      settings.outreach.specificityTest &&
      failsSpecificityTest(emailBody, deal.companyName)
    ) {
      emailBody = `${emailBody} Specifically for ${deal.companyName}.`;
    }
    const subject =
      typeof out.subject === "string" && out.subject.trim()
        ? out.subject.trim()
        : `An idea for ${deal.companyName}`;
    created.push(
      await insertOutreach({
        dealId: research.dealId,
        channel: "gmail",
        recipient: research.email ?? "",
        subject,
        body: ensureFooter(emailBody, footer),
        contactId: research.contactId,
        cadenceTouch: 1,
      }),
    );
  }
  if (!existing("linkedin_connect")) {
    created.push(
      await insertOutreach({
        dealId: research.dealId,
        channel: "linkedin_connect",
        recipient: research.linkedinUrl ?? research.fullName,
        subject: "LinkedIn connection",
        body: connect,
        contactId: research.contactId,
        linkedinUrl: research.linkedinUrl,
        cadenceTouch: 1,
      }),
    );
  }
  if (
    !active.some(
      (item) => item.channel === "linkedin_followup" && item.cadenceTouch === 2,
    )
  ) {
    created.push(
      await insertOutreach({
        dealId: research.dealId,
        channel: "linkedin_followup",
        recipient: research.linkedinUrl ?? research.fullName,
        subject: "LinkedIn follow-up (after accept)",
        body: followup,
        contactId: research.contactId,
        linkedinUrl: research.linkedinUrl,
        cadenceTouch: 2,
      }),
    );
  }
  return {
    created,
    skippedEmail: !canEmail,
    suppressed: Boolean(suppressed),
    replayed: created.length === 0,
  };
}
