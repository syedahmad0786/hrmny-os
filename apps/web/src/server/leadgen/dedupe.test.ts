import { beforeEach, describe, expect, it } from "vitest";
import type { LeadCandidate } from "@hrmny/integrations";
import { resetCrmMemory } from "../crm/memory";
import { listContacts } from "../crm/repository";
import { dedupeIntoCrm } from "./dedupe";

function candidate(over: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    externalId: "apollo_1",
    fullName: "Sara Khan",
    title: "CMO",
    email: "sara@acme.example",
    companyName: "Acme LLC",
    companyDomain: "acme.example",
    source: "apollo",
    raw: {},
    ...over,
  };
}

describe("dedupeIntoCrm", () => {
  beforeEach(() => resetCrmMemory());

  it("creates company + contact + deal for a fresh lead", async () => {
    const res = await dedupeIntoCrm([candidate()]);
    expect(res.created).toHaveLength(1);
    expect(res.skipped).toHaveLength(0);
    expect(res.created[0]!.contactId).toBeTruthy();
    expect(res.created[0]!.dealId).toBeTruthy();
    expect(res.created[0]!.companyId).toBeTruthy();
  });

  it("is idempotent — re-running the same candidates creates no duplicate contacts", async () => {
    const cands = [
      candidate(),
      candidate({ externalId: "apollo_2", email: "omar@acme.example", fullName: "Omar B" }),
    ];
    const first = await dedupeIntoCrm(cands);
    expect(first.created).toHaveLength(2);

    const second = await dedupeIntoCrm(cands);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);

    // Two leads share one company → exactly one company, two contacts total.
    const contacts = await listContacts();
    expect(contacts.filter((c) => (c.email ?? "").endsWith("@acme.example"))).toHaveLength(2);
  });

  it("matches by lower(email) regardless of case", async () => {
    await dedupeIntoCrm([candidate({ email: "Sara@Acme.Example" })]);
    const again = await dedupeIntoCrm([candidate({ email: "sara@acme.example" })]);
    expect(again.skipped).toHaveLength(1);
    expect(again.created).toHaveLength(0);
  });
});
