import { z } from "zod";
import { CAMPAIGN_TRANSITIONS } from "@hrmny/gate";
import type { SocialChannel, SocialPublishResult } from "@hrmny/integrations";
import { router, staffProcedure } from "./trpc";

/**
 * M9 content & marketing — STUB router (mock data, frozen signatures).
 * Wiring into appRouter is orchestrator-only (root.ts). Live publish swaps in
 * behind env flags via the SocialPublishAdapter contract; publish is a
 * `campaign` gate transition (approve → published), never auto-fired here.
 */

type CampaignStatus = keyof typeof CAMPAIGN_TRANSITIONS;

type CampaignItem = {
  id: string;
  title: string;
  channel: SocialChannel;
  status: CampaignStatus;
  /** ISO date the item is scheduled to publish. */
  scheduledFor: string;
  clientId: string;
};

const MOCK_CAMPAIGNS: CampaignItem[] = [
  {
    id: "cmp_0001",
    title: "Ramadan teaser — carousel",
    channel: "linkedin",
    status: "approved",
    scheduledFor: "2026-08-03",
    clientId: "00000000-0000-4000-8000-0000000000a1",
  },
  {
    id: "cmp_0002",
    title: "Product launch reel",
    channel: "instagram",
    status: "draft",
    scheduledFor: "2026-08-07",
    clientId: "00000000-0000-4000-8000-0000000000a1",
  },
];

export const campaignsRouter = router({
  list: staffProcedure
    .input(z.object({ clientId: z.string().uuid().optional() }).optional())
    .query(({ input }): CampaignItem[] =>
      input?.clientId
        ? MOCK_CAMPAIGNS.filter((c) => c.clientId === input.clientId)
        : MOCK_CAMPAIGNS,
    ),

  get: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }): CampaignItem | null =>
      MOCK_CAMPAIGNS.find((c) => c.id === input.id) ?? null,
    ),

  createDraft: staffProcedure
    .input(
      z.object({
        title: z.string().min(1),
        channel: z.enum(["linkedin", "instagram", "facebook", "x"]),
        scheduledFor: z.string(),
        clientId: z.string().uuid(),
      }),
    )
    .mutation(({ input }): CampaignItem => ({
      id: `cmp_stub_${Date.now()}`,
      status: "draft",
      ...input,
    })),

  /** Content-calendar view — items grouped by scheduled date. */
  calendar: staffProcedure
    .input(z.object({ month: z.string().optional() }).optional())
    .query(({ input }) => ({
      month: input?.month ?? new Date().toISOString().slice(0, 7),
      items: MOCK_CAMPAIGNS.map((c) => ({
        id: c.id,
        title: c.title,
        channel: c.channel,
        date: c.scheduledFor,
        status: c.status,
      })),
    })),

  /** Campaign report v1 — posts + engagement pulled back post-publish (mock). */
  report: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const preview: SocialPublishResult = {
        published: true,
        mode: "stub",
        externalId: `stub-post-${input.id}`,
        channel: "linkedin",
        url: "https://example.invalid/post/stub",
      };
      return {
        campaignId: input.id,
        posts: 1,
        impressions: 1240,
        engagements: 87,
        lastPublish: preview,
        note: "Mock engagement — live figures arrive via Composio at M9",
      };
    }),
});
