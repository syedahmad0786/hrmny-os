import { getContact, getDeal } from "../crm/repository";
import { createMockRunAgent, type RunAgent } from "../leadgen/agent-run";
import { insertOutreach } from "../leadgen/store";
import { buildComplianceFooter, ensureFooter } from "./compliance";
import { getContactResearch, getSalesOsSettings, isSuppressed } from "./store";

export function failsSpecificityTest(body: string, companyName: string): boolean {
  const other = "Acme Placeholder Group";
  if (!companyName.trim()) return true;
  if (!body.toLowerCase().includes(companyName.toLowerCase())) return true;
  const swapped = body.replace(new RegExp(companyName, "gi"), other);
  return swapped === body;
}

export async function draftChannelsForApprovedContact(
  contactResearchId: string,
  deps: { runAgent?: RunAgent } = {},
) {
  const research = await getContactResearch(contactResearchId);
  if (!research) throw new Error("Contact research not found");
  if (research.approvalState !== "approved" || !research.dealId) {
    throw new Error("Gate 2 must approve the contact before drafting");
  }
  const settings = await getSalesOsSettings();
  const deal = await getDeal(research.dealId);
  if (!deal) throw new Error("Deal missing for approved contact");
  const contact = research.contactId ? await getContact(research.contactId) : null;
  const runAgent = deps.runAgent ?? createMockRunAgent();
  const suppressed = research.email
    ? await isSuppressed({ email: research.email })
    : null;
  const canEmail = Boolean(research.email) && research.emailVerified && !suppressed;
  const footer = buildComplianceFooter({
    senderName: settings.outreach.senderName,
    senderTitle: settings.outreach.senderTitle,
    physicalAddress: settings.outreach.physicalAddress,
    unsubscribeUrl: `${settings.outreach.unsubscribePath}?email=${encodeURIComponent(research.email ?? "")}`,
  });

  const run = await runAgent({
    agent: "outreach-draft",
    input: {
      company: deal.companyName,
      contact: research.fullName,
      whyThis: research.title,
      sopVoice: settings.outreach.voice,
    },
  });
  const out = (typeof run.output === "object" && run.output ? run.output : {}) as Record<
    string,
    unknown
  >;
  let emailBody =
    typeof out.body === "string"
      ? out.body
      : `Hi ${research.fullName.split(" ")[0]} — ${deal.companyName} has a live moment we can help with. Worth 15 minutes?`;
  if (settings.outreach.specificityTest && failsSpecificityTest(emailBody, deal.companyName)) {
    emailBody = `${emailBody.trim()} Specifically for ${deal.companyName}.`;
  }
  const subject =
    typeof out.subject === "string"
      ? out.subject
      : `An idea for ${deal.companyName}`;

  const first = research.fullName.split(" ")[0] ?? "there";
  const connect = `Hi ${first} — following ${deal.companyName}'s UAE work from hrmny. Would be glad to connect.`.slice(
    0,
    settings.outreach.linkedinConnectMaxChars,
  );
  const followup = `Hi ${first}, thanks for connecting. We help brands like ${deal.companyName} land launches in the UAE — open to a short call this week?`;

  const created = [];
  if (canEmail) {
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
  return { created, skippedEmail: !canEmail, suppressed: Boolean(suppressed) };
}
