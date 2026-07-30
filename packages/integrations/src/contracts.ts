/**
 * Frozen adapter contracts for M8 (lead-gen) / M9 (content) / M11 (ads).
 *
 * These interfaces are the seam downstream workstreams build against before
 * live keys arrive — mock by default, live SDKs fail-loud when misconfigured,
 * exactly like the M2–M6 adapters in `./types.ts`. AI proposes; the gate
 * disposes — nothing here auto-sends, publishes, or spends. Live send/publish
 * is always a gate transition owned by the caller.
 *
 * HITL email / LinkedIn send already ships as `ComposioAdapter.sendAfterApproval`
 * (see `./types.ts` + `./composio`). M8 outreach reuses it; it is not redefined
 * here. This file adds only what does not exist yet.
 */

/** ── M8: lead sourcing (Apollo-shaped) ─────────────────────────────── */

export type LeadSearchCriteria = {
  /** Free-text ICP query (industry, role, geo) — adapter maps to vendor params. */
  query?: string;
  titles?: string[];
  industries?: string[];
  /** ISO country codes or vendor location strings. */
  locations?: string[];
  employeeCountMin?: number;
  employeeCountMax?: number;
  page?: number;
  perPage?: number;
};

export type LeadCandidate = {
  /** Vendor-native id, used for dedupe into CRM before insert. */
  externalId: string;
  fullName?: string;
  title?: string;
  email?: string;
  /** Vendor email confidence when returned without a verification round-trip. */
  emailStatus?: string;
  companyName?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  source: string;
  /** Untyped vendor passthrough for enrichment the CRM stores verbatim. */
  raw: Record<string, unknown>;
};

export interface LeadSourceAdapter {
  readonly mode: "mock" | "live";
  /** ICP search → candidates for CRM dedupe. Never writes the CRM itself. */
  searchLeads(criteria: LeadSearchCriteria): Promise<LeadCandidate[]>;
  /** Enrich a single known contact (email match). */
  enrichLead(email: string): Promise<LeadCandidate | null>;
}

/** ── M8: email verification (Hunter / NeverBounce-shaped) ──────────── */

export type EmailVerificationProvider = "hunter" | "neverbounce";

export type EmailVerificationResult = {
  email: string;
  emailVerified: boolean;
  /** Vendor verdict, e.g. "valid" | "accept_all" | "invalid" | "unknown". */
  verdict: string;
  /** 0–1 confidence when the vendor returns one. */
  score?: number;
  provider: EmailVerificationProvider;
};

/**
 * Generalizes `HunterAdapter.verifyEmail` across providers. A positive verdict
 * gates the verified-email deal transition — which is a payment trigger, so the
 * adapter never invents a verdict (unknown stays unknown).
 */
export interface EmailVerificationAdapter {
  readonly provider: EmailVerificationProvider;
  readonly mode: "mock" | "live";
  verify(email: string): Promise<EmailVerificationResult>;
}

/** ── M9: social publish (HITL-gated, mirrors Composio send) ─────────── */

export type SocialChannel = "linkedin" | "instagram" | "facebook" | "x";

export type SocialPublishInput = {
  channel: SocialChannel;
  /** Post body / caption. */
  content: string;
  /** DAM storage paths or signed URLs for attached media. */
  mediaUrls?: string[];
  /** Connected-account id from the connections manager, when live. */
  connectionId?: string;
};

export type SocialPublishResult = {
  published: boolean;
  /** `stub`: pretend-published in mock; `copy_draft`: no live connection, hand to human. */
  mode: "stub" | "copy_draft" | "live";
  externalId: string;
  channel: SocialChannel;
  /** Permalink when the channel returns one. */
  url?: string;
};

export interface SocialPublishAdapter {
  readonly mode: "mock" | "live";
  listChannels(): Promise<SocialChannel[]>;
  /** Publish after HITL approve — never auto-fires without the caller's gate. */
  publishAfterApproval(input: SocialPublishInput): Promise<SocialPublishResult>;
}

/** ── M11: ads read-only ingestion (Meta / Google-shaped) ───────────── */

export type AdsPlatform = "meta" | "google";

export type AdsCampaignInsight = {
  campaignId: string;
  campaignName: string;
  status: string;
  /** Minor-unit-free decimal strings — money stays string end-to-end (see XeroInvoiceDraft). */
  spend: string;
  budget?: string;
  impressions: number;
  clicks: number;
  conversions?: number;
  currency: string;
};

export type AdsAccountInsights = {
  platform: AdsPlatform;
  accountId: string;
  /** Inclusive ISO date window the figures cover. */
  since: string;
  until: string;
  campaigns: AdsCampaignInsight[];
};

/**
 * Read-only ads ingestion for the spend/pacing dashboard. Budget *management*
 * is out of scope through M12 — there is deliberately no write method here.
 */
export interface AdsInsightsAdapter {
  readonly platform: AdsPlatform;
  readonly mode: "mock" | "live";
  listAccounts(): Promise<{ accountId: string; name: string }[]>;
  getInsights(input: {
    accountId: string;
    since: string;
    until: string;
  }): Promise<AdsAccountInsights>;
}
