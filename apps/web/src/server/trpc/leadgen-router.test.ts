process.env.DATABASE_URL = "";
process.env.COMPOSIO_API_KEY = "";

import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuditWriter, EmitHook } from "@hrmny/gate";
import type { ComposioSendAdapter } from "@hrmny/integrations";
import { createComposioStub } from "@hrmny/integrations";
import type { RunAgent } from "../leadgen/agent-run";
import { resetCrmMemory } from "../crm/memory";
import { createCompany, createContact, createDeal } from "../crm/repository";
import { getOutreach, listOutreach, resetLeadgenStore } from "../leadgen/store";
import {
  approveOutreach,
  discardOutreach,
  draftOutreach,
  sendOutreach,
} from "./leadgen-router";

const staff: ActorContext = { employeeId: "emp-1", roles: ["partner"], permissions: [] };
const portal: ActorContext = { employeeId: "cli-1", roles: ["portal_client"], permissions: [] };

const audit: AuditWriter = async () => ({ auditId: "audit-test" });
const emit: EmitHook = async () => {};

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

async function seedDeal() {
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
  return deal;
}

describe("outreach HITL gate flow", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetLeadgenStore();
  });

  it("drafts from a deal, resolving the recipient email", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello there" });
    expect(item.state).toBe("draft");
    expect(item.recipient).toBe("sara@acme.example");
    expect(item.body).toBe("Hello there");
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
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello" });
    const composio = countingLiveComposio();

    const res = await sendOutreach({ id: item.id, actor: staff, composio, audit, emit });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("GATE_BLOCKED");
    expect(composio.sends).toBe(0);
    expect((await getOutreach(item.id))!.state).toBe("draft");
  });

  it("ALLOWS send after approve — live composio fires once and state becomes sent", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello" });
    const composio = countingLiveComposio();

    const approved = await approveOutreach({ id: item.id, actor: staff, audit, emit });
    expect(approved.ok).toBe(true);
    expect((await getOutreach(item.id))!.state).toBe("approved");
    expect((await getOutreach(item.id))!.approvedBy).toBe("emp-1");

    const sent = await sendOutreach({ id: item.id, actor: staff, composio, audit, emit });
    expect(sent.ok).toBe(true);
    expect(sent.sendMode).toBe("live");
    expect(composio.sends).toBe(1);
    expect(sent.externalId).toBeTruthy();

    const final = (await getOutreach(item.id))!;
    expect(final.state).toBe("sent");
    expect(final.sentAt).toBeTruthy();
    expect(final.externalId).toBeTruthy();
  });

  it("REFUSES stub send — outreach stays approved", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello" });
    await approveOutreach({ id: item.id, actor: staff, audit, emit });
    const stub = createComposioStub();

    await expect(
      sendOutreach({ id: item.id, actor: staff, composio: stub, audit, emit }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await getOutreach(item.id))!.state).toBe("approved");
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

    const res = await sendOutreach({ id: item.id, actor: staff, composio, audit, emit });
    expect(res.ok).toBe(true);
    expect(res.copyDraft).toBe(true);
    expect(res.sendMode).toBe("copy_draft");
    expect((await getOutreach(item.id))!.state).toBe("approved");
  });

  it("BLOCKS a non-staff actor from sending even after approve", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello" });
    const composio = countingLiveComposio();
    await approveOutreach({ id: item.id, actor: staff, audit, emit });

    const res = await sendOutreach({ id: item.id, actor: portal, composio, audit, emit });
    expect(res.ok).toBe(false);
    expect(composio.sends).toBe(0);
    expect((await getOutreach(item.id))!.state).toBe("approved");
  });

  it("discards a draft — and a sent item can never be discarded", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Bye" });
    const res = await discardOutreach({ id: item.id, actor: staff, audit, emit });
    expect(res.ok).toBe(true);
    expect((await getOutreach(item.id))?.state).toBe("discarded");

    const item2 = await draftOutreach({ dealId: deal.dealId, body: "Go" });
    await approveOutreach({ id: item2.id, actor: staff, audit, emit });
    await sendOutreach({
      id: item2.id,
      actor: staff,
      composio: countingLiveComposio(),
      audit,
      emit,
    });
    const blocked = await discardOutreach({ id: item2.id, actor: staff, audit, emit });
    expect(blocked.ok).toBe(false);
    expect((await getOutreach(item2.id))?.state).toBe("sent");
  });
});
