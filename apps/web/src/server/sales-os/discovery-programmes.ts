import { createHash, randomUUID } from "node:crypto";
import {
  and,
  auditEvent,
  connectionAccount,
  desc,
  employee,
  eq,
  researchProgramme,
  researchProgrammeSourceBinding,
  researchProgrammeVersion,
  sql,
  type Db,
} from "@hrmny/db";
import { z } from "zod";
import { previewDiscoverySchedule } from "@/lib/discovery-schedule";
import { CRM_MARKETS } from "@/lib/crm-markets";
import { getDb } from "../db";
import {
  normalizeResearchEvidence,
  ResearchEvidenceError,
} from "./research-evidence";
import {
  armMemoryPublishedSlot,
  pauseMemoryProgrammeRuns,
} from "./discovery-run-queries";
import {
  pauseProgrammeRunsTx,
  schedulePublishedSlotTx,
} from "./discovery-runs";

type LifecycleState = "draft" | "active" | "paused" | "archived";
type SourceFamily =
  | "publication"
  | "hiring"
  | "leadership"
  | "company_intelligence"
  | "intent_import"
  | "government"
  | "watchlist"
  | "submission"
  | "focused_research";
type CapabilityState =
  "candidate" | "unverified" | "blocked" | "manual" | "verified";
type ConnectionState =
  "not_required" | "unverified" | "needs_connection" | "connected" | "error";

export type DiscoverySourceManifestItem = {
  sourceKey: string;
  displayName: string;
  family: SourceFamily;
  adapter: string;
  adapterVersion: string;
  configuration: { url?: string; feedUrl?: string; notes?: string };
  defaultRequired: boolean;
  defaultEnabled: boolean;
  capabilityState: CapabilityState;
  connectionState: ConnectionState;
  statusReason: string;
};

const publication = (
  sourceKey: string,
  displayName: string,
  url: string,
  capabilityState: CapabilityState,
  statusReason: string,
  feedUrl?: string,
): DiscoverySourceManifestItem => ({
  sourceKey,
  displayName,
  family: "publication",
  adapter: feedUrl ? "publisher_feed_or_listing" : "public_listing",
  adapterVersion: "unverified-v1",
  configuration: { url, ...(feedUrl ? { feedUrl } : {}) },
  defaultRequired: true,
  defaultEnabled: true,
  capabilityState,
  connectionState: "not_required",
  statusReason,
});

export const DISCOVERY_SOURCE_MANIFEST: readonly DiscoverySourceManifestItem[] =
  [
    publication(
      "campaign_me",
      "Campaign ME",
      "https://campaignme.com/latest/",
      "candidate",
      "Publisher-declared feed parsed locally; runtime rights and 30-day coverage remain unverified.",
      "https://campaignme.com/feed/",
    ),
    publication(
      "communicate_online",
      "Communicate Online",
      "https://communicateonline.me",
      "unverified",
      "Homepage responded, but no feed declaration or runtime collector was verified.",
    ),
    publication(
      "gulf_business",
      "Gulf Business",
      "https://gulfbusiness.com/en/latest-news/",
      "blocked",
      "The bounded local probe returned 403; an allowed runtime collector is unverified.",
    ),
    publication(
      "arabian_business",
      "Arabian Business",
      "https://arabianbusiness.com",
      "blocked",
      "The bounded local probe returned 403 and separate retrieval failed.",
    ),
    publication(
      "gulf_news_business",
      "Gulf News Business",
      "https://gulfnews.com/business",
      "unverified",
      "The listing responded but hit the bounded payload limit; extraction remains unverified.",
    ),
    publication(
      "khaleej_times_business",
      "Khaleej Times Business",
      "https://khaleejtimes.com/business",
      "unverified",
      "The listing responded, but no deployed collector or date extraction was verified.",
    ),
    publication(
      "the_national_business",
      "The National Business",
      "https://thenationalnews.com/business/",
      "unverified",
      "The listing responded; extraction and restricted-content handling remain unverified.",
    ),
    publication(
      "time_out_dubai",
      "Time Out Dubai",
      "https://timeoutdubai.com/news",
      "blocked",
      "The bounded local probe returned 403; keep this required source visibly blocked.",
    ),
    {
      sourceKey: "linkedin_jobs",
      displayName: "LinkedIn Jobs",
      family: "hiring",
      adapter: "licensed_search",
      adapterVersion: "unverified-v1",
      configuration: {
        notes:
          "Vacancy identity, employer, role, date and open/closed state required.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "unverified",
      connectionState: "needs_connection",
      statusReason: "Permitted search/extraction capability is unverified.",
    },
    {
      sourceKey: "bayt_gulftalent_jobs",
      displayName: "Bayt / GulfTalent",
      family: "hiring",
      adapter: "public_job_listing",
      adapterVersion: "unverified-v1",
      configuration: {
        notes:
          "UAE marketing vacancies; inaccessible or undated listings stay unresolved.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "unverified",
      connectionState: "not_required",
      statusReason: "Runtime access and date extraction are unverified.",
    },
    {
      sourceKey: "apollo_organisation_search",
      displayName: "Apollo organisation search",
      family: "company_intelligence",
      adapter: "apollo_api",
      adapterVersion: "unverified-v1",
      configuration: {
        notes:
          "UAE sector search with bounded pagination; directory presence is not intent.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "unverified",
      connectionState: "needs_connection",
      statusReason:
        "Endpoint entitlement, account identity and cost are unverified.",
    },
    {
      sourceKey: "apollo_job_postings",
      displayName: "Apollo job postings",
      family: "hiring",
      adapter: "apollo_api",
      adapterVersion: "unverified-v1",
      configuration: {
        notes: "Validation for 3–5 shortlisted unfamiliar organisations.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "unverified",
      connectionState: "needs_connection",
      statusReason:
        "Endpoint entitlement, account identity and cost are unverified.",
    },
    {
      sourceKey: "leadership_changes",
      displayName: "Leadership changes",
      family: "leadership",
      adapter: "licensed_or_announcement",
      adapterVersion: "unverified-v1",
      configuration: {
        notes:
          "Licensed capability, dated company announcement or reviewed submission only.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "unverified",
      connectionState: "needs_connection",
      statusReason:
        "No authenticated licensed people-change capability has been verified.",
    },
    {
      sourceKey: "apollo_intent_import",
      displayName: "Apollo intent import",
      family: "intent_import",
      adapter: "authorised_csv_upload",
      adapterVersion: "planned-v1",
      configuration: {
        notes:
          "Private export period, topic, original score and row validation required.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "manual",
      connectionState: "needs_connection",
      statusReason:
        "Upload path and authorised export/account remain unverified.",
    },
    {
      sourceKey: "tejari_government",
      displayName: "Government opportunities / Tejari",
      family: "government",
      adapter: "authenticated_portal",
      adapterVersion: "unverified-v1",
      configuration: {
        url: "https://esupply.dubai.gov.ae",
        notes: "No bid submission; deadline and tender identity required.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "unverified",
      connectionState: "needs_connection",
      statusReason:
        "Account ownership, authentication and permitted collection are unverified.",
    },
    {
      sourceKey: "operator_submissions",
      displayName: "Watchlists and operator submissions",
      family: "submission",
      adapter: "authorised_submission",
      adapterVersion: "planned-v1",
      configuration: {
        notes:
          "Pasted source URL or authorised upload with its access boundary.",
      },
      defaultRequired: true,
      defaultEnabled: false,
      capabilityState: "manual",
      connectionState: "not_required",
      statusReason: "Manual evidence path is planned but not runtime accepted.",
    },
    {
      sourceKey: "focused_company_research",
      displayName: "Focused company research",
      family: "focused_research",
      adapter: "operator_triggered_public_research",
      adapterVersion: "unverified-v1",
      configuration: {
        notes:
          "Evidence-backed operator investigation; no independent connection inferred.",
      },
      defaultRequired: false,
      defaultEnabled: false,
      capabilityState: "unverified",
      connectionState: "not_required",
      statusReason:
        "Workflow pattern exists; the Discovery binding has not been accepted.",
    },
  ] as const;

const laneSchema = z.enum([
  "industry_scanning",
  "apollo_intent",
  "relationship_led",
]);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const discoveryProgrammeConfigSchema = z
  .object({
    name: boundedText(120),
    purpose: boundedText(1_000).min(8),
    ownerEmployeeId: z.string().uuid(),
    reviewerEmployeeIds: z.array(z.string().uuid()).max(10).default([]),
    markets: z.array(z.enum(CRM_MARKETS)).min(1).max(CRM_MARKETS.length),
    acquisitionLanes: z.array(laneSchema).min(1).max(3),
    primarySectors: z.array(boundedText(120)).min(1).max(12),
    secondarySectors: z.array(boundedText(120)).max(12),
    opportunityTypes: z.array(boundedText(120)).min(1).max(20),
    questions: z.array(boundedText(500)).max(20),
    inclusionRules: z.array(boundedText(500)).max(20),
    exclusionRules: z.array(boundedText(500)).max(20),
    rotation: z
      .array(
        z.object({
          weekday: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
          ]),
          primarySector: boundedText(120),
          secondaryFocus: boundedText(240),
        }),
      )
      .min(1)
      .max(5),
    freshness: z.object({
      newsDays: z.number().int().min(1).max(365),
      jobsDays: z.number().int().min(1).max(365),
      leadershipDays: z.number().int().min(1).max(730),
    }),
    schedule: z.object({
      timeZone: z.literal("Asia/Dubai"),
      localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    }),
    limits: z.object({
      desiredCompaniesMin: z.number().int().min(0).max(200),
      desiredCompaniesMax: z.number().int().min(1).max(200),
      desiredMarketSignalsMin: z.number().int().min(0).max(100),
      desiredMarketSignalsMax: z.number().int().min(0).max(100),
      maxObservations: z.number().int().min(1).max(200),
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const uniqueFields: Array<[string, readonly unknown[]]> = [
      ["reviewerEmployeeIds", value.reviewerEmployeeIds],
      ["markets", value.markets],
      ["acquisitionLanes", value.acquisitionLanes],
      ["weekdays", value.schedule.weekdays],
      ["rotation weekdays", value.rotation.map((item) => item.weekday)],
    ];
    for (const [label, values] of uniqueFields) {
      if (new Set<unknown>(values).size !== values.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be unique`,
        });
    }
    if (value.reviewerEmployeeIds.includes(value.ownerEmployeeId))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The owner cannot also be a reviewer",
      });
    if (value.limits.desiredCompaniesMin > value.limits.desiredCompaniesMax)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Company minimum cannot exceed maximum",
      });
    if (
      value.limits.desiredMarketSignalsMin >
      value.limits.desiredMarketSignalsMax
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Signal minimum cannot exceed maximum",
      });
  });

const optionalPublicUrl = z
  .string()
  .trim()
  .max(1_000)
  .transform((value, ctx) => {
    try {
      return normalizeResearchEvidence(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof ResearchEvidenceError
            ? error.message
            : "Use a public HTTPS URL",
      });
      return z.NEVER;
    }
  });

export const discoverySourceDraftSchema = z
  .object({
    sourceKey: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    required: z.boolean(),
    accountReferenceId: z.string().uuid().nullable().optional(),
    configuration: z
      .object({
        url: optionalPublicUrl.optional(),
        feedUrl: optionalPublicUrl.optional(),
        notes: z.string().trim().max(1_000).optional(),
      })
      .strict(),
  })
  .strict();

export type DiscoveryProgrammeConfig = z.infer<
  typeof discoveryProgrammeConfigSchema
>;
export type DiscoverySourceDraft = z.infer<typeof discoverySourceDraftSchema>;

export type DiscoveryProgrammeSnapshotSource = DiscoverySourceDraft &
  DiscoverySourceManifestItem;
export type DiscoveryProgrammeSnapshot = {
  config: DiscoveryProgrammeConfig;
  sources: DiscoveryProgrammeSnapshotSource[];
};
type SnapshotSource = DiscoveryProgrammeSnapshotSource;
type Snapshot = DiscoveryProgrammeSnapshot;

export const DEFAULT_DISCOVERY_PROGRAMME_CONFIG: DiscoveryProgrammeConfig = {
  name: "HRMNY Daily Discovery",
  purpose:
    "Find source-grounded UAE companies and opportunities for human review before qualification.",
  ownerEmployeeId: "00000000-0000-4000-8000-000000000000",
  reviewerEmployeeIds: [],
  markets: ["UAE"],
  acquisitionLanes: ["industry_scanning", "apollo_intent", "relationship_led"],
  primarySectors: [
    "Retail + Consumer Experience",
    "Sports / Wellness / Movements",
    "F&B / Hospitality + Events",
    "Signal-driven",
  ],
  secondarySectors: [
    "Government opportunities",
    "New market entrants",
    "Agency reviews",
  ],
  opportunityTypes: [
    "agency_review",
    "new_market_entry",
    "hiring",
    "leadership_change",
    "government_tender",
    "relationship_introduction",
  ],
  questions: [
    "Why now?",
    "What evidence supports this opportunity?",
    "Which HRMNY service is relevant?",
  ],
  inclusionRules: [
    "Retain original evidence and source date",
    "Keep unknown dates out of the fresh actionable queue",
  ],
  exclusionRules: [
    "Do not treat awarded agency wins as open pitches",
    "Do not infer buyer budget, authority or intent",
  ],
  rotation: [
    {
      weekday: 1,
      primarySector: "Retail + Consumer Experience",
      secondaryFocus: "Government opportunities",
    },
    {
      weekday: 2,
      primarySector: "Sports / Wellness / Movements",
      secondaryFocus: "New market entrants",
    },
    {
      weekday: 3,
      primarySector: "F&B / Hospitality + Events",
      secondaryFocus: "New market entrants; query family requires review",
    },
    {
      weekday: 4,
      primarySector: "Sports / Wellness / Movements",
      secondaryFocus: "Agency reviews",
    },
    {
      weekday: 5,
      primarySector: "Signal-driven",
      secondaryFocus: "Government tenders / Tejari",
    },
  ],
  freshness: { newsDays: 30, jobsDays: 14, leadershipDays: 90 },
  schedule: {
    timeZone: "Asia/Dubai",
    localTime: "06:30",
    weekdays: [1, 2, 3, 4, 5],
  },
  limits: {
    desiredCompaniesMin: 8,
    desiredCompaniesMax: 12,
    desiredMarketSignalsMin: 3,
    desiredMarketSignalsMax: 6,
    maxObservations: 200,
  },
};

export function defaultDiscoverySources(): DiscoverySourceDraft[] {
  return DISCOVERY_SOURCE_MANIFEST.map((source) => ({
    sourceKey: source.sourceKey,
    enabled: source.defaultEnabled,
    required: source.defaultRequired,
    configuration: { ...source.configuration },
  }));
}

export class DiscoveryProgrammeError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "INVALID_PRINCIPAL"
      | "INVALID_SOURCE"
      | "INVALID_CONNECTION",
    message: string,
  ) {
    super(message);
  }
}

type MemoryProgramme = {
  id: string;
  ownerEmployeeId: string;
  reviewerEmployeeIds: string[];
  state: LifecycleState;
  version: number;
  currentDraftVersion: number;
  publishedVersion: number | null;
  scheduleGeneration: number;
  publishedByEmployeeId: string | null;
  publishedAt: string | null;
  pausedByEmployeeId: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  nextDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  versions: Map<
    number,
    { snapshot: Snapshot; hash: string; actor: string; createdAt: string }
  >;
  bindingIds: Map<string, string>;
  bindings: Map<
    string,
    {
      credentialGeneration: number;
      checkpointVersion: number;
      cursor: Record<string, unknown> | null;
      connectionState: ConnectionState;
      lastError: string | null;
    }
  >;
};

const memory = new Map<string, MemoryProgramme>();
const manifestByKey = new Map(
  DISCOVERY_SOURCE_MANIFEST.map((item) => [item.sourceKey, item]),
);

function normalizeSnapshot(
  configInput: unknown,
  sourcesInput?: unknown,
): Snapshot {
  const config = discoveryProgrammeConfigSchema.parse(configInput);
  const supplied = z
    .array(discoverySourceDraftSchema)
    .max(DISCOVERY_SOURCE_MANIFEST.length)
    .parse(sourcesInput ?? defaultDiscoverySources());
  if (
    new Set(supplied.map(({ sourceKey }) => sourceKey)).size !== supplied.length
  )
    throw new DiscoveryProgrammeError(
      "INVALID_SOURCE",
      "Source keys must be unique",
    );
  const suppliedByKey = new Map(
    supplied.map((source) => [source.sourceKey, source]),
  );
  for (const source of supplied) {
    if (!manifestByKey.has(source.sourceKey))
      throw new DiscoveryProgrammeError(
        "INVALID_SOURCE",
        `Unsupported source: ${source.sourceKey}`,
      );
  }
  // Required manifest entries cannot disappear by omission. Disable them
  // explicitly so the coverage gap remains visible in readiness.
  const drafts = DISCOVERY_SOURCE_MANIFEST.map(
    (manifest) =>
      suppliedByKey.get(manifest.sourceKey) ?? {
        sourceKey: manifest.sourceKey,
        enabled: false,
        required: manifest.defaultRequired,
        configuration: { ...manifest.configuration },
      },
  );
  const sources = drafts.map((draft) => {
    const manifest = manifestByKey.get(draft.sourceKey);
    if (!manifest)
      throw new DiscoveryProgrammeError(
        "INVALID_SOURCE",
        `Unsupported source: ${draft.sourceKey}`,
      );
    return {
      ...manifest,
      ...draft,
      configuration: { ...draft.configuration },
    };
  });
  return { config, sources };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function hashSnapshot(snapshot: Snapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

function canAccess(
  programme: { ownerEmployeeId: string; reviewerEmployeeIds: string[] },
  actorId: string,
  isAdmin: boolean,
) {
  return (
    isAdmin ||
    programme.ownerEmployeeId === actorId ||
    programme.reviewerEmployeeIds.includes(actorId)
  );
}

function assertAccess(
  programme: { ownerEmployeeId: string; reviewerEmployeeIds: string[] },
  actorId: string,
  isAdmin: boolean,
) {
  if (!canAccess(programme, actorId, isAdmin))
    throw new DiscoveryProgrammeError("FORBIDDEN", "PROGRAMME_ACCESS_DENIED");
}

function sourceView(
  source: SnapshotSource,
  binding?: {
    id: string;
    adapter: string;
    adapterVersion: string;
    configuration: Record<string, unknown>;
    accountReferenceId: string | null;
    capabilityState: string;
    connectionState: string;
    credentialGeneration: number;
    lastAttemptAt: Date | string | null;
    lastSuccessAt: Date | string | null;
    lastError: string | null;
    coverage: Record<string, unknown>;
  },
) {
  const iso = (value: Date | string | null) =>
    value ? (value instanceof Date ? value.toISOString() : value) : null;
  const bindingMatchesDraft =
    binding &&
    binding.adapter === source.adapter &&
    binding.adapterVersion === source.adapterVersion &&
    binding.accountReferenceId === (source.accountReferenceId ?? null) &&
    canonicalJson(binding.configuration) ===
      canonicalJson(source.configuration);
  return {
    ...source,
    sourceBindingId: binding?.id ?? null,
    accountReferenceId: source.accountReferenceId ?? null,
    capabilityState: (bindingMatchesDraft
      ? binding.capabilityState
      : source.capabilityState) as CapabilityState,
    connectionState: (bindingMatchesDraft
      ? binding.connectionState
      : source.connectionState) as ConnectionState,
    credentialGeneration: bindingMatchesDraft
      ? binding.credentialGeneration
      : 0,
    lastAttemptAt: iso(bindingMatchesDraft ? binding.lastAttemptAt : null),
    lastSuccessAt: iso(bindingMatchesDraft ? binding.lastSuccessAt : null),
    lastError: bindingMatchesDraft ? binding.lastError : null,
    coverage: bindingMatchesDraft ? binding.coverage : {},
  };
}

type ReadinessBlocker = {
  code:
    | "SOURCE_UNVERIFIED"
    | "SOURCE_BLOCKED"
    | "SOURCE_CONNECTION_REQUIRED"
    | "EXECUTION_DISABLED";
  sourceKey: string | null;
  message: string;
};

function readiness(sources: ReturnType<typeof sourceView>[]) {
  const blockers: ReadinessBlocker[] = [];
  for (const source of sources) {
    if (!source.required) continue;
    if (!source.enabled)
      blockers.push({
        code: "SOURCE_UNVERIFIED",
        sourceKey: source.sourceKey,
        message: `${source.displayName}: required source is disabled.`,
      });
    else if (
      source.connectionState === "needs_connection" ||
      source.connectionState === "error"
    )
      blockers.push({
        code: "SOURCE_CONNECTION_REQUIRED",
        sourceKey: source.sourceKey,
        message: `${source.displayName}: ${source.statusReason}`,
      });
    else if (source.capabilityState === "blocked")
      blockers.push({
        code: "SOURCE_BLOCKED",
        sourceKey: source.sourceKey,
        message: `${source.displayName}: ${source.statusReason}`,
      });
    else if (
      source.capabilityState !== "verified" &&
      source.capabilityState !== "manual"
    )
      blockers.push({
        code: "SOURCE_UNVERIFIED",
        sourceKey: source.sourceKey,
        message: `${source.displayName}: ${source.statusReason}`,
      });
  }
  blockers.push({
    code: "EXECUTION_DISABLED" as const,
    sourceKey: null,
    message:
      "Research execution is not available yet. Configuration can be saved.",
  });
  return { ready: false, blockers };
}

type DbProgramme = typeof researchProgramme.$inferSelect;
type DbBinding = typeof researchProgrammeSourceBinding.$inferSelect;
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const CONNECTION_TOOLKITS_BY_ADAPTER: Readonly<
  Record<string, readonly string[]>
> = {
  apollo_api: ["apollo"],
  authorised_csv_upload: ["apollo"],
  licensed_search: ["linkedin", "composio:linkedin"],
  licensed_or_announcement: ["linkedin", "composio:linkedin"],
  authenticated_portal: ["tejari"],
};

function connectionToolkitMatches(
  source: SnapshotSource,
  toolkit: string,
): boolean {
  return (
    CONNECTION_TOOLKITS_BY_ADAPTER[source.adapter]?.includes(toolkit) ?? false
  );
}

function bindingForView(row: DbBinding) {
  return {
    id: row.researchProgrammeSourceBindingId,
    adapter: row.adapter,
    adapterVersion: row.adapterVersion,
    configuration: row.configuration,
    accountReferenceId: row.accountReferenceId,
    capabilityState: row.capabilityState,
    connectionState: row.connectionState,
    credentialGeneration: row.credentialGeneration,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    coverage: row.coverage,
  };
}

async function detailFromDb(db: Db, row: DbProgramme) {
  const [versions, bindings] = await Promise.all([
    db
      .select()
      .from(researchProgrammeVersion)
      .where(
        eq(
          researchProgrammeVersion.researchProgrammeId,
          row.researchProgrammeId,
        ),
      )
      .orderBy(desc(researchProgrammeVersion.versionNumber)),
    db
      .select()
      .from(researchProgrammeSourceBinding)
      .where(
        eq(
          researchProgrammeSourceBinding.researchProgrammeId,
          row.researchProgrammeId,
        ),
      ),
  ]);
  const draftRow = versions.find(
    (item) => item.versionNumber === row.currentDraftVersion,
  );
  if (!draftRow) throw new Error("Discovery draft snapshot is missing");
  const publishedRow = row.publishedVersion
    ? versions.find((item) => item.versionNumber === row.publishedVersion)
    : null;
  const byKey = new Map(
    bindings.map((item) => [item.sourceKey, bindingForView(item)]),
  );
  const versionView = (versionRow: typeof draftRow) => {
    const snapshot = versionRow.configuration as Snapshot;
    return {
      version: versionRow.versionNumber,
      hash: versionRow.configHash,
      config: snapshot.config,
      sources: snapshot.sources.map((item) =>
        sourceView(item, byKey.get(item.sourceKey)),
      ),
      createdAt: versionRow.createdAt.toISOString(),
      createdByEmployeeId: versionRow.createdByEmployeeId,
    };
  };
  const draft = versionView(draftRow);
  return {
    id: row.researchProgrammeId,
    state: row.state as LifecycleState,
    version: row.version,
    draftVersion: row.currentDraftVersion,
    publishedVersion: row.publishedVersion,
    scheduleGeneration: row.scheduleGeneration,
    ownerEmployeeId: row.ownerEmployeeId,
    reviewerEmployeeIds: row.reviewerEmployeeIds,
    draft,
    published: publishedRow ? versionView(publishedRow) : null,
    readiness: readiness(draft.sources),
    schedulePreview: previewDiscoverySchedule(
      draft.config.schedule,
      new Date(),
    ),
    executionEnabled: false as const,
    nextDueAt: row.nextDueAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedByEmployeeId: row.publishedByEmployeeId,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    pausedByEmployeeId: row.pausedByEmployeeId,
    pauseReason: row.pauseReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function detailFromMemory(row: MemoryProgramme) {
  const draftRow = row.versions.get(row.currentDraftVersion)!;
  const publishedRow = row.publishedVersion
    ? (row.versions.get(row.publishedVersion) ?? null)
    : null;
  const versionView = (entry: typeof draftRow, version: number) => ({
    version,
    hash: entry.hash,
    config: entry.snapshot.config,
    sources: entry.snapshot.sources.map((source) => {
      const binding = row.bindings.get(source.sourceKey);
      return sourceView(source, {
        id: row.bindingIds.get(source.sourceKey) ?? "",
        adapter: source.adapter,
        adapterVersion: source.adapterVersion,
        configuration: source.configuration,
        accountReferenceId: source.accountReferenceId ?? null,
        capabilityState: source.capabilityState,
        connectionState: binding?.connectionState ?? source.connectionState,
        credentialGeneration: binding?.credentialGeneration ?? 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: binding?.lastError ?? null,
        coverage: {},
      });
    }),
    createdAt: entry.createdAt,
    createdByEmployeeId: entry.actor,
  });
  const draft = versionView(draftRow, row.currentDraftVersion);
  return {
    id: row.id,
    state: row.state,
    version: row.version,
    draftVersion: row.currentDraftVersion,
    publishedVersion: row.publishedVersion,
    scheduleGeneration: row.scheduleGeneration,
    ownerEmployeeId: row.ownerEmployeeId,
    reviewerEmployeeIds: row.reviewerEmployeeIds,
    draft,
    published:
      publishedRow && row.publishedVersion
        ? versionView(publishedRow, row.publishedVersion)
        : null,
    readiness: readiness(draft.sources),
    schedulePreview: previewDiscoverySchedule(
      draft.config.schedule,
      new Date(),
    ),
    executionEnabled: false as const,
    nextDueAt: row.nextDueAt,
    publishedAt: row.publishedAt,
    publishedByEmployeeId: row.publishedByEmployeeId,
    pausedAt: row.pausedAt,
    pausedByEmployeeId: row.pausedByEmployeeId,
    pauseReason: row.pauseReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function validatePrincipalsAndConnections(
  db: Db,
  snapshot: Snapshot,
  actorEmployeeId: string,
  previousSources: SnapshotSource[] = [],
): Promise<void> {
  const principalIds = [
    snapshot.config.ownerEmployeeId,
    ...snapshot.config.reviewerEmployeeIds,
  ];
  const active = await db
    .select({ id: employee.employeeId })
    .from(employee)
    .where(
      sql`${employee.employeeId} in (select jsonb_array_elements_text(${JSON.stringify(principalIds)}::jsonb)::uuid) and ${employee.isActive} = true and ${employee.lifecycleStatus} = 'active'`,
    );
  if (active.length !== new Set(principalIds).size)
    throw new DiscoveryProgrammeError(
      "INVALID_PRINCIPAL",
      "Programme owners and reviewers must be active employees",
    );
  const previousByKey = new Map(
    previousSources.map((source) => [source.sourceKey, source]),
  );
  const accountIds = [
    ...new Set(
      snapshot.sources.flatMap((source) => {
        if (!source.accountReferenceId) return [];
        const previous = previousByKey.get(source.sourceKey);
        const unchanged =
          previous &&
          previous.adapter === source.adapter &&
          previous.adapterVersion === source.adapterVersion &&
          previous.accountReferenceId === source.accountReferenceId &&
          canonicalJson(previous.configuration) ===
            canonicalJson(source.configuration);
        return unchanged ? [] : [source.accountReferenceId];
      }),
    ),
  ];
  if (!accountIds.length) return;
  const accounts = await db
    .select({
      id: connectionAccount.connectionAccountId,
      ownerId: connectionAccount.ownerEmployeeId,
      scope: connectionAccount.scope,
      status: connectionAccount.status,
      toolkit: connectionAccount.toolkit,
    })
    .from(connectionAccount)
    .where(
      sql`${connectionAccount.connectionAccountId} in (select jsonb_array_elements_text(${JSON.stringify(accountIds)}::jsonb)::uuid)`,
    );
  const accountsById = new Map(
    accounts.map((account) => [account.id, account]),
  );
  if (
    accounts.length !== accountIds.length ||
    snapshot.sources.some((source) => {
      if (!source.accountReferenceId) return false;
      const previous = previousByKey.get(source.sourceKey);
      const unchanged =
        previous &&
        previous.adapter === source.adapter &&
        previous.adapterVersion === source.adapterVersion &&
        previous.accountReferenceId === source.accountReferenceId &&
        canonicalJson(previous.configuration) ===
          canonicalJson(source.configuration);
      if (unchanged) return false;
      const account = accountsById.get(source.accountReferenceId);
      return (
        !account ||
        account.scope !== "staff" ||
        account.status !== "connected" ||
        account.ownerId !== actorEmployeeId ||
        !connectionToolkitMatches(source, account.toolkit)
      );
    })
  )
    throw new DiscoveryProgrammeError(
      "INVALID_CONNECTION",
      "New or changed source connections must be connected, compatible staff accounts owned by the acting employee",
    );
}

async function validateSnapshotForPublish(
  tx: DbTransaction,
  snapshot: Snapshot,
): Promise<void> {
  const principalIds = [
    ...new Set([
      snapshot.config.ownerEmployeeId,
      ...snapshot.config.reviewerEmployeeIds,
    ]),
  ];
  const activePrincipals = await tx
    .select({ id: employee.employeeId })
    .from(employee)
    .where(
      sql`${employee.employeeId} in (select jsonb_array_elements_text(${JSON.stringify(principalIds)}::jsonb)::uuid) and ${employee.isActive} = true and ${employee.lifecycleStatus} = 'active'`,
    )
    .for("share");
  if (activePrincipals.length !== principalIds.length)
    throw new DiscoveryProgrammeError(
      "INVALID_PRINCIPAL",
      "Programme owners and reviewers must still be active employees at publication",
    );

  const sourcesWithAccounts = snapshot.sources.filter(
    (source): source is SnapshotSource & { accountReferenceId: string } =>
      Boolean(source.accountReferenceId),
  );
  const accountIds = [
    ...new Set(sourcesWithAccounts.map((source) => source.accountReferenceId)),
  ];
  if (!accountIds.length) return;
  const accounts = await tx
    .select({
      id: connectionAccount.connectionAccountId,
      ownerId: connectionAccount.ownerEmployeeId,
      scope: connectionAccount.scope,
      status: connectionAccount.status,
      toolkit: connectionAccount.toolkit,
    })
    .from(connectionAccount)
    .where(
      sql`${connectionAccount.connectionAccountId} in (select jsonb_array_elements_text(${JSON.stringify(accountIds)}::jsonb)::uuid)`,
    )
    .for("share");
  const accountsById = new Map(
    accounts.map((account) => [account.id, account]),
  );
  if (
    accounts.length !== accountIds.length ||
    sourcesWithAccounts.some((source) => {
      const account = accountsById.get(source.accountReferenceId);
      return (
        !account ||
        account.scope !== "staff" ||
        account.status !== "connected" ||
        account.ownerId !== snapshot.config.ownerEmployeeId ||
        !connectionToolkitMatches(source, account.toolkit)
      );
    })
  )
    throw new DiscoveryProgrammeError(
      "INVALID_CONNECTION",
      "Published source connections must remain connected, compatible staff accounts owned by the programme owner",
    );
}

async function syncBindings(
  tx: DbTransaction,
  programmeId: string,
  sources: SnapshotSource[],
) {
  for (const source of sources) {
    const [existing] = await tx
      .select()
      .from(researchProgrammeSourceBinding)
      .where(
        and(
          eq(researchProgrammeSourceBinding.researchProgrammeId, programmeId),
          eq(researchProgrammeSourceBinding.sourceKey, source.sourceKey),
        ),
      )
      .limit(1);
    if (!existing) {
      await tx.insert(researchProgrammeSourceBinding).values({
        researchProgrammeId: programmeId,
        sourceKey: source.sourceKey,
        family: source.family,
        adapter: source.adapter,
        adapterVersion: source.adapterVersion,
        configuration: source.configuration,
        accountReferenceId: source.accountReferenceId ?? null,
        enabled: source.enabled,
        required: source.required,
        capabilityState: source.capabilityState,
        connectionState: source.connectionState,
      });
      continue;
    }
    const identityChanged =
      existing.adapter !== source.adapter ||
      existing.adapterVersion !== source.adapterVersion ||
      existing.accountReferenceId !== (source.accountReferenceId ?? null) ||
      canonicalJson(existing.configuration) !==
        canonicalJson(source.configuration);
    await tx
      .update(researchProgrammeSourceBinding)
      .set({
        family: source.family,
        adapter: source.adapter,
        adapterVersion: source.adapterVersion,
        configuration: source.configuration,
        accountReferenceId: source.accountReferenceId ?? null,
        enabled: source.enabled,
        required: source.required,
        ...(identityChanged
          ? {
              capabilityState: source.capabilityState,
              connectionState: source.connectionState,
              credentialGeneration: existing.credentialGeneration + 1,
              capabilityTestReceiptId: null,
              capabilityTestedAt: null,
              checkpointVersion: existing.checkpointVersion + 1,
              cursor: null,
              lastAttemptAt: null,
              lastSuccessAt: null,
              lastError: null,
              coverage: {},
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        eq(
          researchProgrammeSourceBinding.researchProgrammeSourceBindingId,
          existing.researchProgrammeSourceBindingId,
        ),
      );
  }
}

export function discoveryManifest(actorEmployeeId: string) {
  const config = {
    ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
    ownerEmployeeId: actorEmployeeId,
  };
  const sources = normalizeSnapshot(
    config,
    defaultDiscoverySources(),
  ).sources.map((source) => sourceView(source));
  return {
    sourceReference: "outputs/discovery-build-2026-09-20/SOURCE-SEED-MAP.md",
    config,
    sources,
    schedulePreview: previewDiscoverySchedule(config.schedule, new Date()),
    executionEnabled: false as const,
  };
}

export async function createDiscoveryProgramme(input: {
  config: DiscoveryProgrammeConfig;
  sources?: DiscoverySourceDraft[];
  actorEmployeeId: string;
}) {
  const snapshot = normalizeSnapshot(input.config, input.sources);
  if (snapshot.config.ownerEmployeeId !== input.actorEmployeeId)
    throw new DiscoveryProgrammeError(
      "FORBIDDEN",
      "A new programme must be owned by its creator",
    );
  const hash = hashSnapshot(snapshot);
  const now = new Date();
  const db = getDb();
  if (!db) {
    const id = randomUUID();
    const row: MemoryProgramme = {
      id,
      ownerEmployeeId: snapshot.config.ownerEmployeeId,
      reviewerEmployeeIds: snapshot.config.reviewerEmployeeIds,
      state: "draft",
      version: 1,
      currentDraftVersion: 1,
      publishedVersion: null,
      scheduleGeneration: 0,
      publishedByEmployeeId: null,
      publishedAt: null,
      pausedByEmployeeId: null,
      pausedAt: null,
      pauseReason: null,
      nextDueAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      versions: new Map([
        [
          1,
          {
            snapshot,
            hash,
            actor: input.actorEmployeeId,
            createdAt: now.toISOString(),
          },
        ],
      ]),
      bindingIds: new Map(
        snapshot.sources.map((source) => [source.sourceKey, randomUUID()]),
      ),
      bindings: new Map(),
    };
    memory.set(id, row);
    return detailFromMemory(row);
  }
  await validatePrincipalsAndConnections(db, snapshot, input.actorEmployeeId);
  const id = await db.transaction(async (tx) => {
    const [programme] = await tx
      .insert(researchProgramme)
      .values({
        ownerEmployeeId: snapshot.config.ownerEmployeeId,
        reviewerEmployeeIds: snapshot.config.reviewerEmployeeIds,
      })
      .returning({ id: researchProgramme.researchProgrammeId });
    if (!programme) throw new Error("Failed to create Discovery programme");
    await tx.insert(researchProgrammeVersion).values({
      researchProgrammeId: programme.id,
      versionNumber: 1,
      configuration: snapshot,
      configHash: hash,
      createdByEmployeeId: input.actorEmployeeId,
    });
    await syncBindings(tx, programme.id, snapshot.sources);
    await tx.insert(auditEvent).values({
      actorEmployeeId: input.actorEmployeeId,
      action: "sales.discovery.programme.created",
      entityType: "research_programme",
      entityId: programme.id,
      after: { version: 1, draftVersion: 1, configHash: hash },
    });
    return programme.id;
  });
  return getDiscoveryProgramme({
    programmeId: id,
    actorEmployeeId: input.actorEmployeeId,
    isAdmin: false,
  });
}

export async function getDiscoveryProgramme(input: {
  programmeId: string;
  actorEmployeeId: string;
  isAdmin: boolean;
}) {
  const db = getDb();
  if (!db) {
    const row = memory.get(input.programmeId);
    if (!row)
      throw new DiscoveryProgrammeError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
    assertAccess(row, input.actorEmployeeId, input.isAdmin);
    return detailFromMemory(row);
  }
  const [row] = await db
    .select()
    .from(researchProgramme)
    .where(eq(researchProgramme.researchProgrammeId, input.programmeId))
    .limit(1);
  if (!row)
    throw new DiscoveryProgrammeError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
  assertAccess(row, input.actorEmployeeId, input.isAdmin);
  return detailFromDb(db, row);
}

export async function listDiscoveryProgrammes(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
  state?: LifecycleState;
}) {
  const db = getDb();
  const accessPredicate = input.isAdmin
    ? undefined
    : sql`(${researchProgramme.ownerEmployeeId} = ${input.actorEmployeeId}::uuid or ${input.actorEmployeeId}::uuid = any(${researchProgramme.reviewerEmployeeIds}::uuid[]))`;
  const statePredicate = input.state
    ? eq(researchProgramme.state, input.state)
    : undefined;
  const dbPredicate =
    accessPredicate && statePredicate
      ? and(accessPredicate, statePredicate)
      : (accessPredicate ?? statePredicate);
  const details = db
    ? await Promise.all(
        (
          await db
            .select()
            .from(researchProgramme)
            .where(dbPredicate)
            .orderBy(desc(researchProgramme.updatedAt))
        ).map((row) => detailFromDb(db, row)),
      )
    : [...memory.values()]
        .filter(
          (row) =>
            (!input.state || row.state === input.state) &&
            canAccess(row, input.actorEmployeeId, input.isAdmin),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(detailFromMemory);
  return details.map((item) => ({
    id: item.id,
    name: item.draft.config.name,
    purpose: item.draft.config.purpose,
    state: item.state,
    version: item.version,
    draftVersion: item.draftVersion,
    publishedVersion: item.publishedVersion,
    ownerEmployeeId: item.ownerEmployeeId,
    reviewerEmployeeIds: item.reviewerEmployeeIds,
    requiredSourceCount: item.draft.sources.filter((source) => source.required)
      .length,
    blockedSourceCount: item.readiness.blockers.filter(
      (blocker) => blocker.sourceKey,
    ).length,
    schedulePreview: item.schedulePreview,
    executionEnabled: false as const,
    nextDueAt: item.nextDueAt,
    updatedAt: item.updatedAt,
  }));
}

export async function saveDiscoveryProgrammeDraft(input: {
  programmeId: string;
  expectedVersion: number;
  config: DiscoveryProgrammeConfig;
  sources: DiscoverySourceDraft[];
  actorEmployeeId: string;
  isAdmin: boolean;
}) {
  const snapshot = normalizeSnapshot(input.config, input.sources);
  const hash = hashSnapshot(snapshot);
  const db = getDb();
  if (!db) {
    const row = memory.get(input.programmeId);
    if (!row)
      throw new DiscoveryProgrammeError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
    assertAccess(row, input.actorEmployeeId, input.isAdmin);
    if (row.version !== input.expectedVersion)
      throw new DiscoveryProgrammeError(
        "CONFLICT",
        "PROGRAMME_VERSION_CONFLICT",
      );
    const principalsChanged =
      row.ownerEmployeeId !== snapshot.config.ownerEmployeeId ||
      JSON.stringify(row.reviewerEmployeeIds) !==
        JSON.stringify(snapshot.config.reviewerEmployeeIds);
    if (principalsChanged && !input.isAdmin)
      throw new DiscoveryProgrammeError(
        "FORBIDDEN",
        "Only a Sales administrator can change programme ownership",
      );
    const now = new Date().toISOString();
    row.version += 1;
    row.currentDraftVersion += 1;
    if (row.publishedVersion === null) {
      row.ownerEmployeeId = snapshot.config.ownerEmployeeId;
      row.reviewerEmployeeIds = snapshot.config.reviewerEmployeeIds;
    }
    row.updatedAt = now;
    row.versions.set(row.currentDraftVersion, {
      snapshot,
      hash,
      actor: input.actorEmployeeId,
      createdAt: now,
    });
    for (const source of snapshot.sources)
      if (!row.bindingIds.has(source.sourceKey))
        row.bindingIds.set(source.sourceKey, randomUUID());
    return detailFromMemory(row);
  }
  const [existing] = await db
    .select()
    .from(researchProgramme)
    .where(eq(researchProgramme.researchProgrammeId, input.programmeId))
    .limit(1);
  if (!existing)
    throw new DiscoveryProgrammeError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
  assertAccess(existing, input.actorEmployeeId, input.isAdmin);
  if (
    !input.isAdmin &&
    (existing.ownerEmployeeId !== snapshot.config.ownerEmployeeId ||
      JSON.stringify(existing.reviewerEmployeeIds) !==
        JSON.stringify(snapshot.config.reviewerEmployeeIds))
  )
    throw new DiscoveryProgrammeError(
      "FORBIDDEN",
      "Only a Sales administrator can change programme ownership",
    );
  const [previousVersion] = await db
    .select({ configuration: researchProgrammeVersion.configuration })
    .from(researchProgrammeVersion)
    .where(
      and(
        eq(researchProgrammeVersion.researchProgrammeId, input.programmeId),
        eq(
          researchProgrammeVersion.versionNumber,
          existing.currentDraftVersion,
        ),
      ),
    )
    .limit(1);
  if (!previousVersion) throw new Error("Discovery draft snapshot is missing");
  await validatePrincipalsAndConnections(
    db,
    snapshot,
    input.actorEmployeeId,
    (previousVersion.configuration as Snapshot).sources,
  );
  try {
    await db.transaction(async (tx) => {
      const nextDraftVersion = existing.currentDraftVersion + 1;
      const [updated] = await tx
        .update(researchProgramme)
        .set({
          ...(existing.publishedVersion === null
            ? {
                ownerEmployeeId: snapshot.config.ownerEmployeeId,
                reviewerEmployeeIds: snapshot.config.reviewerEmployeeIds,
              }
            : {}),
          version: input.expectedVersion + 1,
          currentDraftVersion: nextDraftVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(researchProgramme.researchProgrammeId, input.programmeId),
            eq(researchProgramme.version, input.expectedVersion),
          ),
        )
        .returning({ id: researchProgramme.researchProgrammeId });
      if (!updated)
        throw new DiscoveryProgrammeError(
          "CONFLICT",
          "PROGRAMME_VERSION_CONFLICT",
        );
      await tx.insert(researchProgrammeVersion).values({
        researchProgrammeId: input.programmeId,
        versionNumber: nextDraftVersion,
        configuration: snapshot,
        configHash: hash,
        createdByEmployeeId: input.actorEmployeeId,
      });
      // Once published, draft edits remain snapshots until the explicit
      // publish command updates the stable runtime binding.
      if (existing.publishedVersion === null)
        await syncBindings(tx, input.programmeId, snapshot.sources);
      await tx.insert(auditEvent).values({
        actorEmployeeId: input.actorEmployeeId,
        action: "sales.discovery.programme.draft_saved",
        entityType: "research_programme",
        entityId: input.programmeId,
        before: {
          version: input.expectedVersion,
          draftVersion: existing.currentDraftVersion,
        },
        after: {
          version: input.expectedVersion + 1,
          draftVersion: nextDraftVersion,
          configHash: hash,
        },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new DiscoveryProgrammeError(
        "CONFLICT",
        "PROGRAMME_VERSION_CONFLICT",
      );
    throw error;
  }
  return getDiscoveryProgramme(input);
}

async function transitionProgramme(input: {
  programmeId: string;
  expectedVersion: number;
  actorEmployeeId: string;
  action: "publish" | "pause";
  reason?: string;
}) {
  const db = getDb();
  if (!db) {
    const row = memory.get(input.programmeId);
    if (!row)
      throw new DiscoveryProgrammeError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
    if (row.version !== input.expectedVersion)
      throw new DiscoveryProgrammeError(
        "CONFLICT",
        "PROGRAMME_VERSION_CONFLICT",
      );
    const now = new Date().toISOString();
    row.version += 1;
    row.updatedAt = now;
    if (input.action === "publish") {
      const snapshot = row.versions.get(row.currentDraftVersion)!.snapshot;
      row.state = "active";
      row.ownerEmployeeId = snapshot.config.ownerEmployeeId;
      row.reviewerEmployeeIds = snapshot.config.reviewerEmployeeIds;
      row.publishedVersion = row.currentDraftVersion;
      row.scheduleGeneration += 1;
      row.publishedAt = now;
      row.publishedByEmployeeId = input.actorEmployeeId;
      row.pausedAt = row.pausedByEmployeeId = row.pauseReason = null;
      row.nextDueAt = previewDiscoverySchedule(
        snapshot.config.schedule,
        new Date(),
        1,
      )[0]!;
      armMemoryPublishedSlot({
        programmeId: row.id,
        programmeName: snapshot.config.name,
        ownerEmployeeId: row.ownerEmployeeId,
        reviewerEmployeeIds: row.reviewerEmployeeIds,
        scheduleGeneration: row.scheduleGeneration,
        publishedVersion: row.publishedVersion,
        maxObservations: snapshot.config.limits.maxObservations,
        runAt: row.nextDueAt,
        sourceKeys: snapshot.sources
          .filter((source) => source.enabled)
          .map((source) => source.sourceKey),
      });
    } else {
      row.state = "paused";
      row.scheduleGeneration += 1;
      row.pausedAt = now;
      row.pausedByEmployeeId = input.actorEmployeeId;
      row.pauseReason = input.reason ?? null;
      row.nextDueAt = null;
      pauseMemoryProgrammeRuns({
        programmeId: row.id,
        actorEmployeeId: input.actorEmployeeId,
        reason: input.reason ?? "paused",
      });
    }
    return detailFromMemory(row);
  }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(researchProgramme)
      .where(eq(researchProgramme.researchProgrammeId, input.programmeId))
      .limit(1)
      .for("update");
    if (!existing)
      throw new DiscoveryProgrammeError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
    if (existing.version !== input.expectedVersion)
      throw new DiscoveryProgrammeError(
        "CONFLICT",
        "PROGRAMME_VERSION_CONFLICT",
      );
    const [draftVersion] =
      input.action === "publish"
        ? await tx
            .select()
            .from(researchProgrammeVersion)
            .where(
              and(
                eq(
                  researchProgrammeVersion.researchProgrammeId,
                  input.programmeId,
                ),
                eq(
                  researchProgrammeVersion.versionNumber,
                  existing.currentDraftVersion,
                ),
              ),
            )
            .limit(1)
        : [null];
    if (input.action === "publish" && !draftVersion)
      throw new Error("Discovery draft snapshot is missing");
    const snapshot = draftVersion?.configuration as Snapshot | undefined;
    if (snapshot) await validateSnapshotForPublish(tx, snapshot);
    const values =
      input.action === "publish"
        ? {
            state: "active",
            ownerEmployeeId: snapshot!.config.ownerEmployeeId,
            reviewerEmployeeIds: snapshot!.config.reviewerEmployeeIds,
            version: input.expectedVersion + 1,
            publishedVersion: existing.currentDraftVersion,
            scheduleGeneration: existing.scheduleGeneration + 1,
            publishedAt: now,
            publishedByEmployeeId: input.actorEmployeeId,
            pausedAt: null,
            pausedByEmployeeId: null,
            pauseReason: null,
            updatedAt: now,
          }
        : {
            state: "paused",
            version: input.expectedVersion + 1,
            scheduleGeneration: existing.scheduleGeneration + 1,
            pausedAt: now,
            pausedByEmployeeId: input.actorEmployeeId,
            pauseReason: input.reason ?? null,
            updatedAt: now,
          };
    const rows = await tx
      .update(researchProgramme)
      .set(values)
      .where(
        and(
          eq(researchProgramme.researchProgrammeId, input.programmeId),
          eq(researchProgramme.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!rows[0])
      throw new DiscoveryProgrammeError(
        "CONFLICT",
        "PROGRAMME_VERSION_CONFLICT",
      );
    if (snapshot) await syncBindings(tx, input.programmeId, snapshot.sources);
    if (input.action === "publish" && snapshot && draftVersion) {
      await schedulePublishedSlotTx(tx, {
        programmeId: input.programmeId,
        programmeVersionId: draftVersion.researchProgrammeVersionId,
        scheduleGeneration: existing.scheduleGeneration + 1,
        snapshot,
        now,
      });
    }
    if (input.action === "pause") {
      await pauseProgrammeRunsTx(tx, {
        programmeId: input.programmeId,
        actorEmployeeId: input.actorEmployeeId,
        reason: input.reason ?? "paused",
        now,
      });
    }
    await tx.insert(auditEvent).values({
      actorEmployeeId: input.actorEmployeeId,
      action: `sales.discovery.programme.${input.action}`,
      entityType: "research_programme",
      entityId: input.programmeId,
      before: {
        version: input.expectedVersion,
        state: existing.state,
        publishedVersion: existing.publishedVersion,
      },
      after: {
        version: input.expectedVersion + 1,
        state: values.state,
        publishedVersion:
          input.action === "publish"
            ? existing.currentDraftVersion
            : existing.publishedVersion,
        executionEnabled: false,
      },
      reason: input.reason,
    });
    return rows;
  });
  if (!updated)
    throw new DiscoveryProgrammeError("CONFLICT", "PROGRAMME_VERSION_CONFLICT");
  return getDiscoveryProgramme({
    programmeId: input.programmeId,
    actorEmployeeId: input.actorEmployeeId,
    isAdmin: true,
  });
}

export const publishDiscoveryProgramme = (input: {
  programmeId: string;
  expectedVersion: number;
  actorEmployeeId: string;
}) => transitionProgramme({ ...input, action: "publish" });

export const pauseDiscoveryProgramme = (input: {
  programmeId: string;
  expectedVersion: number;
  actorEmployeeId: string;
  reason: string;
}) => transitionProgramme({ ...input, action: "pause" });

export async function reconnectDiscoverySource(input: {
  programmeId: string;
  sourceKey: string;
  actorEmployeeId: string;
  isAdmin: boolean;
  reason: string;
}) {
  const programme = await getDiscoveryProgramme({
    programmeId: input.programmeId,
    actorEmployeeId: input.actorEmployeeId,
    isAdmin: input.isAdmin,
  });
  const source = programme.draft.sources.find(
    (item) => item.sourceKey === input.sourceKey,
  );
  if (!source)
    throw new DiscoveryProgrammeError("INVALID_SOURCE", "SOURCE_NOT_FOUND");
  const db = getDb();
  if (!db) {
    const row = memory.get(input.programmeId);
    if (!row) throw new DiscoveryProgrammeError("NOT_FOUND", "PROGRAMME_NOT_FOUND");
    const existing = row.bindings.get(input.sourceKey);
    row.bindings.set(input.sourceKey, {
      credentialGeneration: (existing?.credentialGeneration ?? 0) + 1,
      checkpointVersion: (existing?.checkpointVersion ?? 0) + 1,
      cursor: existing?.cursor ?? null,
      connectionState:
        source.connectionState === "not_required"
          ? "not_required"
          : "needs_connection",
      lastError: null,
    });
    row.updatedAt = new Date().toISOString();
    return getDiscoveryProgramme({
      programmeId: input.programmeId,
      actorEmployeeId: input.actorEmployeeId,
      isAdmin: input.isAdmin,
    });
  }
  const [binding] = await db
    .select()
    .from(researchProgrammeSourceBinding)
    .where(
      and(
        eq(
          researchProgrammeSourceBinding.researchProgrammeId,
          input.programmeId,
        ),
        eq(researchProgrammeSourceBinding.sourceKey, input.sourceKey),
      ),
    )
    .limit(1);
  if (!binding)
    throw new DiscoveryProgrammeError("INVALID_SOURCE", "SOURCE_BINDING_NOT_FOUND");
  await db.transaction(async (tx) => {
    await tx
      .update(researchProgrammeSourceBinding)
      .set({
        credentialGeneration: binding.credentialGeneration + 1,
        checkpointVersion: binding.checkpointVersion + 1,
        connectionState:
          binding.connectionState === "not_required"
            ? "not_required"
            : "needs_connection",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        eq(
          researchProgrammeSourceBinding.researchProgrammeSourceBindingId,
          binding.researchProgrammeSourceBindingId,
        ),
      );
    await tx.insert(auditEvent).values({
      actorEmployeeId: input.actorEmployeeId,
      action: "discovery.source.reconnected",
      entityType: "research_programme",
      entityId: input.programmeId,
      before: {
        sourceKey: input.sourceKey,
        credentialGeneration: binding.credentialGeneration,
      },
      after: {
        sourceKey: input.sourceKey,
        credentialGeneration: binding.credentialGeneration + 1,
        collectorStarted: false,
      },
      reason: input.reason,
    });
  });
  return getDiscoveryProgramme({
    programmeId: input.programmeId,
    actorEmployeeId: input.actorEmployeeId,
    isAdmin: input.isAdmin,
  });
}
