import { beforeEach, describe, expect, it } from "vitest";
import { resetCrmMemory } from "./memory";
import {
  createCompany,
  createContact,
  createDeal,
  listDeals,
  listNotes,
} from "./repository";
import {
  resetIntegrationReceiptMemory,
  recordIntegrationReceipt,
} from "../integrations/inbox";
import {
  getCompletedApolloFreeSearchCrmImports,
  persistCompletedApolloFreeSearchToCrm,
} from "./apollo-search-import";

const ACTOR = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const SEARCH = "00000000-0000-4000-8000-000000000010";

async function completedSearch() {
  return recordIntegrationReceipt({
    provider: "apollo",
    externalEventId: SEARCH,
    operation: "people.search.zero-credit",
    rawBody: JSON.stringify({ actorEmployeeId: ACTOR, idempotencyKey: SEARCH }),
    completed: true,
    ownerEmployeeId: ACTOR,
    result: {
      bridgeStatus: "completed",
      candidates: [
        {
          externalId: "apollo-person-1",
          fullName: "Mina Example",
          title: "Chief Executive Officer",
          companyName: "Example Motors",
          companyDomain: "example-motors.test",
          source: "apollo",
        },
      ],
    },
  });
}

describe("Apollo free-search CRM persistence", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetIntegrationReceiptMemory();
  });

  it("imports each actor-owned Apollo id once without overwriting a staffed contact or deal", async () => {
    const company = await createCompany({
      name: "Example Motors",
      website: "https://example-motors.test",
    });
    const staffedContact = await createContact({
      companyId: company.companyId,
      firstName: "Mina",
      lastName: "Example",
      title: "Staff-maintained title",
      isPrimary: true,
    });
    const staffedDeal = await createDeal({
      companyId: company.companyId,
      companyName: company.name,
      primaryContactId: staffedContact.contactId,
      ownerEmployeeId: OTHER,
      leadSourceLane: "relationship_led",
    });
    const searchReceipt = await completedSearch();

    const first = await persistCompletedApolloFreeSearchToCrm({
      sourceSearchReceiptId: searchReceipt.receiptId,
      idempotencyKey: SEARCH,
      actorEmployeeId: ACTOR,
    });
    const replay = await persistCompletedApolloFreeSearchToCrm({
      sourceSearchReceiptId: searchReceipt.receiptId,
      idempotencyKey: SEARCH,
      actorEmployeeId: ACTOR,
    });
    const visible = await getCompletedApolloFreeSearchCrmImports({
      sourceSearchReceiptId: searchReceipt.receiptId,
      idempotencyKey: SEARCH,
      actorEmployeeId: ACTOR,
    });

    expect(first[0]).toMatchObject({
      externalId: "apollo-person-1",
      status: "completed",
      duplicate: false,
    });
    expect(replay).toEqual([{ ...first[0], duplicate: true }]);
    expect(visible).toEqual(replay);
    expect(
      (await listDeals({ companyId: company.companyId })).map(
        (deal) => deal.ownerEmployeeId,
      ),
    ).toEqual([OTHER, ACTOR]);
    expect(
      (await listDeals({ companyId: company.companyId })).find(
        (deal) => deal.dealId === staffedDeal.dealId,
      )?.primaryContactId,
    ).toBe(staffedContact.contactId);
    expect(await listNotes({ dealId: first[0]!.dealId })).toHaveLength(1);
    expect((await listNotes({ dealId: first[0]!.dealId }))[0]?.body).toContain(
      "Source receipt:",
    );
  });

  it("does not allow another employee to read or import a completed search", async () => {
    const searchReceipt = await completedSearch();
    await expect(
      persistCompletedApolloFreeSearchToCrm({
        sourceSearchReceiptId: searchReceipt.receiptId,
        idempotencyKey: SEARCH,
        actorEmployeeId: OTHER,
      }),
    ).rejects.toThrow("APOLLO_SEARCH_IMPORT_FORBIDDEN");
  });
});
