import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuditWriter, EmitHook } from "@hrmny/gate";
import type { ComposioSendAdapter } from "@hrmny/integrations";
import { createComposioStub } from "@hrmny/integrations";
import { resetCrmMemory } from "../crm/memory";
import { createCompany, createContact, createDeal } from "../crm/repository";
import { getOutreach, resetLeadgenStore } from "../leadgen/store";
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

/** Composio stub that counts sends so we can prove send is gated. */
function countingComposio(): ComposioSendAdapter & { sends: number } {
  const base = createComposioStub();
  const wrapper = {
    ...base,
    sends: 0,
    async sendAfterApproval(input: Parameters<ComposioSendAdapter["sendAfterApproval"]>[0]) {
      wrapper.sends += 1;
      return base.sendAfterApproval(input);
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

  it("BLOCKS send before human approve — no external send fires", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello" });
    const composio = countingComposio();

    const res = await sendOutreach({ id: item.id, actor: staff, composio, audit, emit });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("GATE_BLOCKED");
    expect(composio.sends).toBe(0);
    expect((await getOutreach(item.id))!.state).toBe("draft");
  });

  it("ALLOWS send after approve — composio fires once and state becomes sent", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello" });
    const composio = countingComposio();

    const approved = await approveOutreach({ id: item.id, actor: staff, audit, emit });
    expect(approved.ok).toBe(true);
    expect((await getOutreach(item.id))!.state).toBe("approved");
    expect((await getOutreach(item.id))!.approvedBy).toBe("emp-1");

    const sent = await sendOutreach({ id: item.id, actor: staff, composio, audit, emit });
    expect(sent.ok).toBe(true);
    expect(composio.sends).toBe(1);
    expect(sent.externalId).toBeTruthy();

    const final = (await getOutreach(item.id))!;
    expect(final.state).toBe("sent");
    expect(final.sentAt).toBeTruthy();
    expect(final.externalId).toBeTruthy();
  });

  it("BLOCKS a non-staff actor from sending even after approve", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Hello" });
    const composio = countingComposio();
    await approveOutreach({ id: item.id, actor: staff, audit, emit });

    const res = await sendOutreach({ id: item.id, actor: portal, composio, audit, emit });
    expect(res.ok).toBe(false);
    expect(composio.sends).toBe(0);
    expect((await getOutreach(item.id))!.state).toBe("approved");
  });

  it("discards a draft � and a sent item can never be discarded", async () => {
    const deal = await seedDeal();
    const item = await draftOutreach({ dealId: deal.dealId, body: "Bye" });
    const res = await discardOutreach({ id: item.id, actor: staff, audit, emit });
    expect(res.ok).toBe(true);
    expect((await getOutreach(item.id))?.state).toBe("discarded");

    const item2 = await draftOutreach({ dealId: deal.dealId, body: "Go" });
    await approveOutreach({ id: item2.id, actor: staff, audit, emit });
    await sendOutreach({ id: item2.id, actor: staff, composio: countingComposio(), audit, emit });
    const blocked = await discardOutreach({ id: item2.id, actor: staff, audit, emit });
    expect(blocked.ok).toBe(false);
    expect((await getOutreach(item2.id))?.state).toBe("sent");
  });
});
