import {
  closeDurableDeal,
  durableHandoverPack,
  type HandoverPackResult,
} from "./handover";
import {
  createCompany,
  createContact,
  createDeal,
  moveDealStage,
  updateDeal,
} from "./repository";

export type ClosedLoopInput = {
  companyName?: string;
  viaApollo?: boolean;
  actorEmployeeId?: string | null;
};

export type ClosedLoopSuccess = {
  ok: true;
  companyId: string;
  contactId: string;
  dealId: string;
  clientId: string;
  clientName: string;
  taskId: string | null;
  calendarId: string | null;
  portalInvite: HandoverPackResult["portalInvite"];
  outreachId: string | null;
  invoiceId: string | null;
  campaignItemId: string | null;
  onboardingPhases: number;
  fired: string[];
  viaApollo: boolean;
  apolloMode: "mock" | "live" | null;
  next: HandoverPackResult["next"] & {
    crmDeal: string;
    billing: string;
  };
};

export type ClosedLoopResult =
  | ClosedLoopSuccess
  | {
      ok: false;
      step: string;
      reason: string;
      code?: string;
      dealId?: string;
    };

/**
 * Prospect → pipeline → won → client onboarding → creative QC.
 * Shared by Hunt UI (`crm.runDemoClosedLoop`) and agent `crm.closed_loop`.
 * Mock-safe when Apollo/Hunter keys are absent.
 */
export async function runDemoClosedLoopCore(
  input: ClosedLoopInput = {},
): Promise<ClosedLoopResult> {
  const stamp = Date.now();
  let companyId: string;
  let contactId: string;
  let dealId: string;
  let apolloMode: "mock" | "live" | null = null;

  if (input.viaApollo) {
    const { importApolloCompaniesToCrm } = await import("./apollo-import");
    const {
      resolveApolloRuntimeConfig,
      resolveEmailVerificationRuntimeConfig,
    } = await import("../integrations/runtime-adapters");
    const { createApolloAdapter, createEmailVerificationAdapter } =
      await import("@hrmny/integrations");
    const query = input.companyName?.trim() || `Demo Retail UAE ${stamp}`;
    const apollo = await resolveApolloRuntimeConfig(input.actorEmployeeId);
    const verifier = await resolveEmailVerificationRuntimeConfig(
      input.actorEmployeeId ?? undefined,
    );
    const apolloClient = createApolloAdapter(apollo.config);
    apolloMode = apollo.mode;
    const hits = await apolloClient.searchCompanies(query);
    const imported = await importApolloCompaniesToCrm({
      query,
      companies: hits as Record<string, unknown>[],
      mode: apolloMode,
      ownerEmployeeId: input.actorEmployeeId,
      limit: 1,
      verifier: createEmailVerificationAdapter(verifier.config),
    });
    const first = imported.deals[0];
    if (!first) {
      return {
        ok: false,
        step: "apollo",
        reason: "Apollo returned no companies",
      };
    }
    companyId = first.companyId;
    contactId = first.contactId ?? "";
    dealId = first.dealId;
    if (!contactId) {
      const contact = await createContact({
        companyId,
        firstName: "Apollo",
        lastName: "Prospect",
        email: `apollo+${stamp}@example.com`,
        isPrimary: true,
      });
      contactId = contact.contactId;
      await updateDeal(dealId, { primaryContactId: contactId });
    }
  } else {
    const companyName = input.companyName?.trim() || `Demo Hunt ${stamp}`;
    const company = await createCompany({
      name: companyName,
      market: "UAE",
      website: `https://demo-${stamp}.example`,
    });
    const contact = await createContact({
      companyId: company.companyId,
      firstName: "Demo",
      lastName: "Prospect",
      email: `prospect+${stamp}@example.com`,
      title: "Marketing Lead",
      isPrimary: true,
    });
    const deal = await createDeal({
      companyName: company.name,
      companyId: company.companyId,
      primaryContactId: contact.contactId,
      leadSourceLane: "relationship_led",
      ownerEmployeeId: input.actorEmployeeId,
    });
    companyId = company.companyId;
    contactId = contact.contactId;
    dealId = deal.dealId;
  }

  const stages = [
    "qualify",
    "engage",
    "scope",
    "propose",
    "price_cost",
  ] as const;
  for (const to of stages) {
    const moved = await moveDealStage({
      dealId,
      to,
      actorEmployeeId: input.actorEmployeeId,
    });
    if (!moved.ok) {
      return {
        ok: false,
        step: `stage:${to}`,
        reason: moved.reason,
      };
    }
  }

  await updateDeal(dealId, {
    quoteValue: "50000",
    internalCost: "28000",
  });

  const closed = await closeDurableDeal({
    dealId,
    outcome: "won",
    actorEmployeeId: input.actorEmployeeId,
  });
  if (!closed.ok) {
    return {
      ok: false,
      step: "close",
      reason: closed.reason,
      code: closed.code,
    };
  }

  const pack = await durableHandoverPack({
    dealId,
    actorEmployeeId: input.actorEmployeeId,
  });
  if (!pack.ok) {
    return {
      ok: false,
      step: "handover",
      reason: pack.reason,
      code: pack.code,
      dealId,
    };
  }

  return {
    ok: true,
    companyId,
    contactId,
    dealId,
    clientId: pack.client.clientId,
    clientName: pack.client.name,
    taskId: pack.task?.taskId ?? null,
    calendarId: pack.calendarId,
    portalInvite: pack.portalInvite,
    outreachId: pack.outreachId,
    invoiceId: pack.invoiceId,
    campaignItemId: pack.campaignItemId,
    onboardingPhases: pack.onboardingPhases,
    fired: pack.pack.fired,
    viaApollo: Boolean(input.viaApollo),
    apolloMode,
    next: {
      crmDeal: `/crm/deals/${dealId}`,
      ...pack.next,
      billing: "/billing",
    },
  };
}
