import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDemoStore } from "../demo-store";
import { resetCampaignMemory } from "../campaigns/memory";
import { listCampaigns } from "../campaigns/repository";
import { durableHandoverPack } from "./handover";
import { getCrmMemory, resetCrmMemory } from "./memory";
import { createNote } from "./repository";

const WON_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

async function seedHandoverEvidence() {
  await createNote({
    dealId: WON_DEAL_ID,
    body: "HANDOVER:BRAND_ASSETS — Client Drive folder received",
  });
  await createNote({
    dealId: WON_DEAL_ID,
    body: "HANDOVER:BILLING_DETAILS — TRN confirmed by Finance",
  });
}

describe("memory CRM handover", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("DATABASE_MODE", "memory");
    resetCrmMemory();
    resetCampaignMemory();
    getDemoStore().resetM6Demo();
    const deal = getCrmMemory().deals.get(WON_DEAL_ID);
    if (!deal) throw new Error("missing won-deal fixture");
    deal.stage = "close";
    deal.closeOutcome = "won";
  });

  it("replays the same first creative task for one won deal", async () => {
    await seedHandoverEvidence();
    const portalTokensBefore = getDemoStore().portalMagicTokens.size;
    const first = await durableHandoverPack({ dealId: WON_DEAL_ID });
    const replay = await durableHandoverPack({ dealId: WON_DEAL_ID });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.client.clientId).toBe(first.client.clientId);
    expect(first.scopeId).toBe(replay.scopeId);
    expect(first.sourceQuoteId).toBe("16000000-0000-4000-8000-000000000001");
    expect(first.scopeDeliverableCount).toBe(1);
    expect(replay.scopeDeliverableCount).toBe(1);
    expect(first.invoiceStatus).toBe("proposed");
    expect(replay.invoiceStatus).toBe("proposed");
    expect(first.pack.scopeId).toBe(first.scopeId);
    expect(first.pack.invoice).toEqual({
      invoiceId: first.invoiceId,
      status: "proposed",
    });
    const promotedScope = getDemoStore().scopes.get(first.scopeId);
    expect(promotedScope?.status).toBe("active");
    expect(promotedScope?.lines).toEqual([
      {
        label: "Synthetic JWMM retainer",
        qty: 1,
        unitSell: 85_000,
        unitCost: 48_000,
        isVendor: false,
      },
    ]);
    expect(getDemoStore().scopes.size).toBe(1);
    expect(first.task).not.toBeNull();
    expect(replay.task).not.toBeNull();
    if (!first.task || !replay.task) return;
    expect(replay.task.taskId).toBe(first.task.taskId);
    expect(replay.task.briefId).toBe(first.task.briefId);
    expect(
      [...getDemoStore().calendars.values()].filter(
        (calendar) => calendar.clientId === first.client.clientId,
      ),
    ).toHaveLength(1);
    expect(
      await listCampaigns({ clientId: first.client.clientId }),
    ).toHaveLength(1);
    expect(replay.pack.fired).toContain("calendar.exists");
    expect(replay.pack.fired).toContain("campaign.draft_exists");
    expect(first.portalInvite).toBeNull();
    expect(replay.portalInvite).toBeNull();
    expect(first.pack.fired).toContain("portal.invite_pending_approval");
    expect(getDemoStore().portalMagicTokens.size).toBe(portalTokensBefore);
  });

  it("returns incomplete and leaves the deal before handover when a required effect fails", async () => {
    await seedHandoverEvidence();
    const store = getDemoStore();
    vi.spyOn(store, "seedWonCreativeTask").mockReturnValue(undefined as never);

    const result = await durableHandoverPack({ dealId: WON_DEAL_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HANDOVER_INCOMPLETE");
    expect(result.requiredFailures).toContain("delivery.initial_task");
    expect(result.completed).toContain("scope.deliverables_ready");
    expect(store.scopes.size).toBe(1);
    expect(getCrmMemory().deals.get(WON_DEAL_ID)?.stage).toBe("close");
  });

  it("refuses to create Delivery records until all six handover facts exist", async () => {
    await createNote({
      dealId: WON_DEAL_ID,
      body: "HANDOVER:BRAND_ASSETS —",
    });
    await createNote({
      dealId: WON_DEAL_ID,
      body: "HANDOVER:BILLING_DETAILS —   ",
    });
    const clientCount = getDemoStore().clients.size;
    const scopeCount = getDemoStore().scopes.size;
    const result = await durableHandoverPack({ dealId: WON_DEAL_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.requiredFailures).toEqual([
      "evidence.brand_assets",
      "evidence.billing_details",
    ]);
    expect(getDemoStore().clients.size).toBe(clientCount);
    expect(getDemoStore().scopes.size).toBe(scopeCount);
    expect(getCrmMemory().deals.get(WON_DEAL_ID)?.stage).toBe("close");
  });
});
