import { randomUUID } from "node:crypto";
import type { SocialChannel } from "@hrmny/integrations";

/**
 * In-memory campaign store — the no-DATABASE_URL fallback for the campaigns
 * repository, mirroring apps/web/src/server/crm/memory.ts. Seeded with items
 * scoped to the portal dev clients (see auth/session.ts portal_a / portal_b) so
 * the /portal approvals demo surfaces real pending items with no DB.
 */

export type CampaignStatus = "draft" | "approved" | "published" | "archived";

export type CampaignItemRow = {
  campaignItemId: string;
  title: string;
  channel: SocialChannel;
  status: CampaignStatus;
  /** ISO date (yyyy-mm-dd) the item is scheduled to publish, or null. */
  scheduledFor: string | null;
  clientId: string | null;
  /**
   * Free-form payload. Also carries the client-approval decision that the
   * campaign `status` column (CHECK: draft/approved/published/archived) cannot
   * express: `clientDecision: "rejected"` + optional `clientFeedback`.
   */
  body: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const CLIENT_A = "c1000000-0000-4000-8000-0000000000a4";
const CLIENT_B = "c1000000-0000-4000-8000-0000000000b4";

const now = () => new Date().toISOString();
const day = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);

function seedItems(): Map<string, CampaignItemRow> {
  const t = now();
  const rows: CampaignItemRow[] = [
    {
      campaignItemId: "c9000000-0000-4000-8000-000000000001",
      title: "Ramadan teaser — carousel",
      channel: "linkedin",
      status: "draft",
      scheduledFor: day(4),
      clientId: CLIENT_A,
      body: { brief: "Warm teaser ahead of the enhancement-program film." },
      createdAt: t,
      updatedAt: t,
    },
    {
      campaignItemId: "c9000000-0000-4000-8000-000000000002",
      title: "Product launch reel",
      channel: "instagram",
      status: "draft",
      scheduledFor: day(8),
      clientId: CLIENT_A,
      body: { brief: "30s reel, Arabic subtitles." },
      createdAt: t,
      updatedAt: t,
    },
    {
      campaignItemId: "c9000000-0000-4000-8000-000000000003",
      title: "Case-study announcement",
      channel: "linkedin",
      status: "approved",
      scheduledFor: day(2),
      clientId: CLIENT_B,
      body: { brief: "Client-approved; ready for staff publish." },
      createdAt: t,
      updatedAt: t,
    },
  ];
  return new Map(rows.map((r) => [r.campaignItemId, r]));
}

export type CampaignMemory = { items: Map<string, CampaignItemRow> };

let memory: CampaignMemory | null = null;

export function getCampaignMemory(): CampaignMemory {
  if (memory) return memory;
  memory = { items: seedItems() };
  return memory;
}

export function resetCampaignMemory(): CampaignMemory {
  memory = null;
  return getCampaignMemory();
}

export function newCampaignId(): string {
  return randomUUID();
}
