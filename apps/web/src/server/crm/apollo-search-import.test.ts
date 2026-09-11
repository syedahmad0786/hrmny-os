import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveActiveStaffById } from "../auth/session";
import { featureEnabled } from "../features";
import { importApolloPersonToCrm } from "./apollo-import";
vi.mock("../auth/session", () => ({ resolveActiveStaffById: vi.fn() }));
vi.mock("../features", () => ({ featureEnabled: vi.fn() }));
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
  failIntegrationReceipt,
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
    vi.mocked(resolveActiveStaffById).mockResolvedValue({
      employeeId: ACTOR,
      email: "actor@hrmny.co",
      displayName: "Actor",
      actorType: "staff",
      clientId: null,
      roles: ["partner"],
      permissions: ["allow:*:*"],
    });
    vi.mocked(featureEnabled).mockResolvedValue(true);
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

  it("recovers a failed partial receipt without duplicating its CRM records or note", async () => {
    const search = await completedSearch();
    const receipt = await recordIntegrationReceipt({
      provider: "apollo",
      externalEventId: `free-auto-import:${ACTOR}:apollo-person-1`,
      operation: "people.search.auto_import",
      status: "processing",
      ownerEmployeeId: ACTOR,
      rawBody: JSON.stringify({
        actorEmployeeId: ACTOR,
        externalId: "apollo-person-1",
      }),
    });
    const partial = await importApolloPersonToCrm({
      person: {
        externalId: "apollo-person-1",
        fullName: "Mina Example",
        companyName: "Example Motors",
        source: "apollo",
        raw: {},
      },
      receiptId: receipt.receiptId,
      ownerEmployeeId: ACTOR,
      preserveExistingFields: true,
      dedupeReceiptNote: true,
    });
    await failIntegrationReceipt(receipt.receiptId, "INTERRUPTED");
    const recovered = await persistCompletedApolloFreeSearchToCrm({
      sourceSearchReceiptId: search.receiptId,
      idempotencyKey: SEARCH,
      actorEmployeeId: ACTOR,
    });
    expect(recovered[0]).toMatchObject({
      status: "completed",
      contactId: partial.contactId,
      dealId: partial.dealId,
    });
    expect(await listNotes({ dealId: partial.dealId })).toHaveLength(1);
  });

  it.each(["inactive", "crm_disabled"])(
    "refuses imports when %s",
    async (reason) => {
      const search = await completedSearch();
      const before = await listDeals();
      if (reason === "inactive")
        vi.mocked(resolveActiveStaffById).mockResolvedValue(null);
      else vi.mocked(featureEnabled).mockResolvedValue(false);
      await expect(
        persistCompletedApolloFreeSearchToCrm({
          sourceSearchReceiptId: search.receiptId,
          idempotencyKey: SEARCH,
          actorEmployeeId: ACTOR,
        }),
      ).rejects.toThrow("APOLLO_CRM_IMPORT_FORBIDDEN");
      expect(await listDeals()).toEqual(before);
    },
  );
});
