process.env.DATABASE_URL = "";
process.env.COMPOSIO_API_KEY = "";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext, AuditWriter, EmitHook } from "@hrmny/gate";
import type { ComposioSendAdapter } from "@hrmny/integrations";
import { createComposioStub } from "@hrmny/integrations";
import type { RunAgent } from "../leadgen/agent-run";
import { resetCrmMemory } from "../crm/memory";
import {
  createCompany,
  createContact,
  createDeal,
  updateContact,
} from "../crm/repository";
import { getOutreach, listOutreach, resetLeadgenStore } from "../leadgen/store";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import {
  approveOutreach,
  discardOutreach,
  draftOutreach,
  sendOutreach,
} from "./leadgen-router";
import { createCaller } from "./root";
import {
  getIntegrationReceipt,
  resetIntegrationReceiptMemory,
} from "../integrations/inbox";

const staff: ActorContext = {
  employeeId: "emp-1",
  roles: ["partner"],
  permissions: [],
};
const portal: ActorContext = {
  employeeId: "cli-1",
  roles: ["portal_client"],
  permissions: [],
};

const audit: AuditWriter = async () => ({ auditId: "audit-test" });
const emit: EmitHook = async () => {};
const COMPLIANT_BODY =
  "Hi Sara — I noticed Acme LLC is growing in the UAE and have one relevant idea to share.";

function sendReceiptId(item: Awaited<ReturnType<typeof draftOutreach>>) {
  return `outreach-send:${item.id}`;
}

/** Live-mode adapter that counts sends (unit tests must not durable-send on stub). */
function countingLiveComposio(): ComposioSendAdapter & { sends: number } {
  const base = createComposioStub();
  let seq = 0;
  const wrapper = {
    ...base,
    sends: 0,
    async sendAfterApproval(
      input: Parameters<ComposioSendAdapter["sendAfterApproval"]>[0],
    ) {
      wrapper.sends += 1;
      if (input.toolkit === "linkedin") {
        return {
          sent: false,
          mode: "copy_draft" as const,
          externalId: `test-li-${++seq}`,
          channel: "linkedin" as const,
        };
      }
      return {
        sent: true,
        mode: "live" as const,
        externalId: `test-gmail-${++seq}`,
        channel: "gmail" as const,
      };
    },
  };
  return wrapper;
}

async function seedDeal(verified = true) {
  const company = await createCompany({ name: "Acme LLC" });
  const contact = await createContact({
    companyId: company.companyId,
    firstName: "Sara",
    email: "sara@acme.example",
  });
  const deal = await createDeal({
    companyName: "Acme LLC",
    companyId: company.companyId,
    primaryContactId: contact.contactId,
  });
  if (verified) await updateContact(contact.contactId, { emailVerified: true });
  return deal;
}

describe("outreach HITL gate flow", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetLeadgenStore();
    resetIntegrationReceiptMemory();
  });

  it("drafts from a deal, resolving the recipient email", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: "Hello there",
    });
    expect(item.state).toBe("draft");
    expect(item.recipient).toBe("sara@acme.example");
    expect(item.body).toContain("Hello there");
    expect(item.body).toContain("— hrmny outreach —");
    expect(item.body).toContain("?token=");
  });

  it("replaces a legacy email unsubscribe query before approval", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    const { patchOutreach } = await import("../leadgen/store");
    await patchOutreach(item.id, {
      body: `${COMPLIANT_BODY}\n— hrmny outreach —\nUnsubscribe: /api/sales-os/unsubscribe?email=sara%40acme.example`,
    });

    await approveOutreach({ id: item.id, actor: staff, audit, emit });

    const approved = (await getOutreach(item.id))!;
    expect(approved.body).toContain("?token=");
    expect(approved.body).not.toContain("?email=");
  });

  it("REFUSES an empty-body draft when the agent is disabled — nothing inserted", async () => {
    const deal = await seedDeal();
    const refusingAgent: RunAgent = async (input) => ({
      agent: input.agent,
      model: "disabled",
      output: { refused: true, message: "outreach-draft agent is disabled" },
      inputTokens: 0,
      outputTokens: 0,
      costAed: 0,
      gateOutcome: "not_applicable",
    });

    await expect(
      draftOutreach({ dealId: deal.dealId, runAgent: refusingAgent }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "outreach-draft agent is disabled",
    });
    expect(await listOutreach()).toHaveLength(0);
  });

  it("BLOCKS send before human approve — no external send fires", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    const composio = countingLiveComposio();

    const res = await sendOutreach({
      id: item.id,
      actor: staff,
      composio,
      audit,
      emit,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("GATE_BLOCKED");
    expect(composio.sends).toBe(0);
    expect((await getOutreach(item.id))!.state).toBe("draft");
  });

  it("ALLOWS send after approve — live composio fires once and state becomes sent", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    const composio = countingLiveComposio();

    const approved = await approveOutreach({
      id: item.id,
      actor: staff,
      audit,
      emit,
    });
    expect(approved.ok).toBe(true);
    expect((await getOutreach(item.id))!.state).toBe("approved");
    expect((await getOutreach(item.id))!.approvedBy).toBe("emp-1");

    const sent = await sendOutreach({
      id: item.id,
      actor: staff,
      composio,
      audit,
      emit,
    });
    expect(sent.ok).toBe(true);
    expect(sent.sendMode).toBe("live");
    expect(composio.sends).toBe(1);
    expect(sent.externalId).toBeTruthy();

    const final = (await getOutreach(item.id))!;
    expect(final.state).toBe("sent");
    expect(final.sentAt).toBeTruthy();
    expect(final.externalId).toBeTruthy();
  });

  it("reconciles a completed send receipt without sending Gmail twice", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    const composio = countingLiveComposio();
    await approveOutreach({ id: item.id, actor: staff, audit, emit });
    await sendOutreach({ id: item.id, actor: staff, composio, audit, emit });
    expect(composio.sends).toBe(1);

    const { patchOutreach } = await import("../leadgen/store");
    await patchOutreach(item.id, { state: "approved", sentAt: null });
    const replay = await sendOutreach({
      id: item.id,
      actor: staff,
      composio,
      audit,
      emit,
    });
    expect(replay.ok).toBe(true);
    expect(composio.sends).toBe(1);
    expect((await getOutreach(item.id))?.state).toBe("sent");
  });

  it("blocks replay when a Gmail provider outcome is uncertain", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    await approveOutreach({ id: item.id, actor: staff, audit, emit });
    let sends = 0;
    const uncertain = {
      ...createComposioStub(),
      async sendAfterApproval() {
        sends += 1;
        throw new Error("connection closed after submit");
      },
    } satisfies ComposioSendAdapter;

    await expect(
      sendOutreach({
        id: item.id,
        actor: staff,
        composio: uncertain,
        audit,
        emit,
      }),
    ).rejects.toThrow(/connection closed/);
    await expect(
      sendOutreach({
        id: item.id,
        actor: staff,
        composio: uncertain,
        audit,
        emit,
      }),
    ).rejects.toThrow(/will not send it twice/i);
    expect(sends).toBe(1);
    expect((await getOutreach(item.id))?.state).toBe("approved");
    await expect(
      getIntegrationReceipt("gmail", sendReceiptId(item)),
    ).resolves.toMatchObject({
      status: "processing",
      result: { bridgeStatus: "reconcile_required" },
    });
    const { patchOutreach } = await import("../leadgen/store");
    await patchOutreach(item.id, {
      body: `${COMPLIANT_BODY} Updated after the uncertain attempt.`,
    });
    await expect(
      sendOutreach({
        id: item.id,
        actor: staff,
        composio: uncertain,
        audit,
        emit,
      }),
    ).rejects.toThrow(/PAYLOAD_MISMATCH/);
    expect(sends).toBe(1);
  });

  it("REFUSES stub send — outreach stays approved", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    await approveOutreach({ id: item.id, actor: staff, audit, emit });
    const stub = createComposioStub();

    await expect(
      sendOutreach({ id: item.id, actor: staff, composio: stub, audit, emit }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await getOutreach(item.id))!.state).toBe("approved");

    const live = countingLiveComposio();
    await expect(
      sendOutreach({ id: item.id, actor: staff, composio: live, audit, emit }),
    ).resolves.toMatchObject({ ok: true, sendMode: "live" });
    expect(live.sends).toBe(1);
  });

  it("blocks Gmail before the provider when the recipient is unverified", async () => {
    const deal = await seedDeal(false);
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    await approveOutreach({ id: item.id, actor: staff, audit, emit });
    const composio = countingLiveComposio();

    await expect(
      sendOutreach({ id: item.id, actor: staff, composio, audit, emit }),
    ).rejects.toThrow(/verified by the connected provider/i);
    expect(composio.sends).toBe(0);
    expect((await getOutreach(item.id))?.state).toBe("approved");
  });

  it("LinkedIn copy-draft stays approved (not sent)", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      channel: "linkedin",
      body: "LinkedIn note",
    });
    await approveOutreach({ id: item.id, actor: staff, audit, emit });
    const composio = countingLiveComposio();

    const res = await sendOutreach({
      id: item.id,
      actor: staff,
      composio,
      audit,
      emit,
    });
    expect(res.ok).toBe(true);
    expect(res.copyDraft).toBe(true);
    expect(res.sendMode).toBe("copy_draft");
    expect((await getOutreach(item.id))!.state).toBe("approved");
  });

  it("BLOCKS a non-staff actor from sending even after approve", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    const composio = countingLiveComposio();
    await approveOutreach({ id: item.id, actor: staff, audit, emit });

    const res = await sendOutreach({
      id: item.id,
      actor: portal,
      composio,
      audit,
      emit,
    });
    expect(res.ok).toBe(false);
    expect(composio.sends).toBe(0);
    expect((await getOutreach(item.id))!.state).toBe("approved");
  });

  it("discards a draft — and a sent item can never be discarded", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Bye" });
    const res = await discardOutreach({
      id: item.id,
      actor: staff,
      audit,
      emit,
    });
    expect(res.ok).toBe(true);
    expect((await getOutreach(item.id))?.state).toBe("discarded");

    const item2 = await draftOutreach({
      dealId: deal.dealId,
      body: COMPLIANT_BODY,
    });
    await approveOutreach({ id: item2.id, actor: staff, audit, emit });
    await sendOutreach({
      id: item2.id,
      actor: staff,
      composio: countingLiveComposio(),
      audit,
      emit,
    });
    const blocked = await discardOutreach({
      id: item2.id,
      actor: staff,
      audit,
      emit,
    });
    expect(blocked.ok).toBe(false);
    expect((await getOutreach(item2.id))?.state).toBe("sent");
  });
});

describe("legacy daily pipeline containment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps the compatibility route inert even under hostile live-provider flags", async () => {
    vi.stubEnv("APOLLO_MODE", "live");
    vi.stubEnv("APOLLO_API_KEY", "must-not-be-used");
    vi.stubEnv("HUNTER_MODE", "live");
    vi.stubEnv("HUNTER_ALLOW_PAID_OPERATIONS", "true");
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "must-not-be-used");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must remain unreachable"));
    resetCrmMemory();
    resetLeadgenStore();
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });

    await expect(caller.leadgen.runDailyPipeline()).resolves.toEqual({
      ran: false,
      skipped: "legacy_pipeline_disabled",
      next: "/crm/hunt",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await listOutreach()).toHaveLength(0);
  });
});
