import { createHash, randomUUID } from "node:crypto";
import {
  and,
  auditEvent,
  company as companyTable,
  contact as contactTable,
  deal as dealTable,
  desc,
  discoveryCandidate,
  discoveryObservation,
  eq,
  scheduledJob,
  sql,
} from "@hrmny/db";
import { z } from "zod";
import { CRM_MARKETS, type CrmMarket } from "@/lib/crm-markets";
import { getDb } from "../db";
import {
  createCompany,
  getCompany,
  listCompanies,
  listContacts,
  listDeals,
} from "../crm/repository";
import { classifyDiscoveryReviewState } from "./discovery-evidence";
import {
  discoveryEvidenceRoute,
  evaluateDiscoveryEvidence,
  isCompanyNameGroundedInExcerpt,
  markDuplicateEvaluation,
  readStoredDiscoveryIdentityLineage,
  redactHiddenEvaluation,
  type DiscoveryEvidenceEvaluation,
  type DiscoveryIdentityLineage,
} from "./discovery-interpretation";
import { getDiscoveryProgramme } from "./discovery-programmes";
import {
  normalizeResearchCompanyName,
  normalizeResearchEvidence,
  normalizeResearchWebsiteHost,
  ResearchEvidenceError,
} from "./research-evidence";

export { classifyDiscoveryReviewState };

export const DISCOVERY_REVIEW_STATES = [
  "needs_review",
  "needs_evidence",
  "parked",
  "rejected",
  "accepted",
  "corrected",
] as const;
export const DISCOVERY_QUEUES = [
  ...DISCOVERY_REVIEW_STATES,
  "all",
] as const;
export const DISCOVERY_STRATEGIC_LANES = [
  "industry_scanning",
  "apollo_intent",
  "relationship_led",
  "unresolved",
] as const;
export const DISCOVERY_CHANNELS = [
  "publication",
  "hiring",
  "leadership",
  "company_intelligence",
  "intent_import",
  "government",
  "watchlist",
  "submission",
  "focused_research",
] as const;
export const DISCOVERY_OPPORTUNITY_KINDS = [
  "company_signal",
  "hiring",
  "leadership",
  "tender",
  "intent",
  "submission",
] as const;
export const DISCOVERY_VISIBILITY_SCOPES = [
  "public",
  "restricted",
  "private",
] as const;

export type DiscoveryReviewState = (typeof DISCOVERY_REVIEW_STATES)[number];
export type DiscoveryQueue = (typeof DISCOVERY_QUEUES)[number];
export type DiscoveryVisibility = (typeof DISCOVERY_VISIBILITY_SCOPES)[number];

export class DiscoveryCandidateError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "INVALID_STATE"
      | "INVALID_INPUT"
      | "REPLAY_CONFLICT"
      | "COMPANY_IDENTITY_CONFLICT"
      | "COMPANY_IDENTITY_AMBIGUOUS"
      | "COMPANY_LINK_CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

export const discoveryCandidateSubmitSchema = z.object({
  requestId: z.string().uuid(),
  companyName: z.string().trim().min(2).max(180),
  website: z.string().trim().url().max(500).optional(),
  sector: z.string().trim().max(180).optional(),
  market: z.enum(CRM_MARKETS).default("UAE"),
  strategicLane: z.enum(DISCOVERY_STRATEGIC_LANES).default("unresolved"),
  discoveryChannel: z.enum(DISCOVERY_CHANNELS).default("submission"),
  opportunityKind: z.enum(DISCOVERY_OPPORTUNITY_KINDS).default("submission"),
  whyNow: z.string().trim().min(8).max(2_000),
  relevantService: z.string().trim().max(180).optional(),
  missingFacts: z.string().trim().max(2_000).optional(),
  knownRelationship: z.string().trim().max(500).optional(),
  sourceKey: z.string().trim().max(80).optional(),
  sourceItemId: z.string().trim().max(180).optional(),
  externalOpportunityId: z.string().trim().max(180).optional(),
  sourceUrl: z.string().trim().url().max(1_000),
  excerpt: z.string().trim().min(8).max(2_000),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  visibilityScope: z.enum(DISCOVERY_VISIBILITY_SCOPES).default("public"),
  programmeId: z.string().uuid().optional(),
});

export const discoveryCandidateListSchema = z.object({
  queue: z.enum(DISCOVERY_QUEUES).default("needs_review"),
});

const decisionReason = z.string().trim().min(8).max(2_000);

export const discoveryCandidateDecideSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    candidateId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    action: z.literal("link"),
    candidateId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    companyId: z.string().uuid(),
    reason: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    action: z.literal("park"),
    candidateId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    reason: decisionReason,
  }),
  z.object({
    action: z.literal("reject"),
    candidateId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    reason: decisionReason,
  }),
  z.object({
    action: z.literal("request_evidence"),
    candidateId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    reason: decisionReason,
  }),
  z.object({
    action: z.literal("correct"),
    candidateId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
    reason: decisionReason,
    companyName: z.string().trim().min(2).max(180).optional(),
    website: z.string().trim().url().max(500).optional(),
    whyNow: z.string().trim().min(8).max(2_000).optional(),
    relevantService: z.string().trim().max(180).optional(),
    missingFacts: z.string().trim().max(2_000).optional(),
    knownRelationship: z.string().trim().max(500).optional(),
    sourceUrl: z.string().trim().url().max(1_000).optional(),
    excerpt: z.string().trim().min(8).max(2_000).optional(),
    eventDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    visibilityScope: z.enum(DISCOVERY_VISIBILITY_SCOPES).optional(),
  }),
]);

type SubmitInput = z.input<typeof discoveryCandidateSubmitSchema>;
type DecideInput = z.infer<typeof discoveryCandidateDecideSchema>;
type DiscoveryQuery = Pick<NonNullable<ReturnType<typeof getDb>>, "select">;
export type DiscoveryWriteTx = Pick<
  NonNullable<ReturnType<typeof getDb>>,
  "select" | "insert"
>;

export type CollectorIngestStatus =
  | "ingested"
  | "duplicate"
  | "replay"
  | "quarantined";

type MemoryObservation = {
  id: string;
  candidateId: string;
  visibilityScope: DiscoveryVisibility;
  sourceOwnerEmployeeId: string;
  sourceUrl: string;
  excerpt: string | null;
  excerptHash: string;
  publishedOrEventDate: string | null;
  observedAt: string;
  verificationState: "unverified" | "dated" | "needs_evidence" | "corroborated";
  redactionState: "none" | "redacted" | "tombstoned";
  sourceKey: string | null;
  sourceItemId: string | null;
  contentHash: string;
  supersedesObservationId: string | null;
  createdAt: string;
};

type MemoryCandidate = {
  id: string;
  requestId: string;
  payloadHash: string;
  opportunityKey: string;
  companyName: string;
  website: string | null;
  sector: string | null;
  market: CrmMarket;
  strategicLane: (typeof DISCOVERY_STRATEGIC_LANES)[number];
  discoveryChannel: (typeof DISCOVERY_CHANNELS)[number];
  opportunityKind: (typeof DISCOVERY_OPPORTUNITY_KINDS)[number];
  whyNow: string;
  relevantService: string | null;
  missingFacts: string | null;
  knownRelationship: string | null;
  sourceKey: string | null;
  sourceItemId: string | null;
  externalOpportunityId: string | null;
  reviewState: DiscoveryReviewState;
  decisionReason: string | null;
  qualificationState: "not_assessed";
  expectedVersion: number;
  ownerEmployeeId: string;
  reviewerEmployeeIds: string[];
  programmeId: string | null;
  runId: string | null;
  companyId: string | null;
  createdByEmployeeId: string;
  decidedByEmployeeId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  observations: MemoryObservation[];
};

export type DiscoveryCandidateAudit = {
  action: string;
  entityId: string;
  actorEmployeeId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
};

const memoryCandidates = new Map<string, MemoryCandidate>();
const memoryByRequest = new Map<string, string>();
const memoryAudits: DiscoveryCandidateAudit[] = [];
const decisionLocks = new Map<string, Promise<void>>();

export function resetMemoryDiscoveryCandidates() {
  memoryCandidates.clear();
  memoryByRequest.clear();
  memoryAudits.length = 0;
}

export function listMemoryDiscoveryCandidateAudits() {
  return [...memoryAudits];
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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slugFragment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function buildDiscoveryOpportunityKey(input: {
  discoveryChannel: string;
  opportunityKind: string;
  companyName: string;
  website?: string | null;
  sourceUrl?: string | null;
  sourceItemId?: string | null;
  externalOpportunityId?: string | null;
  whyNow: string;
}) {
  if (input.externalOpportunityId?.trim()) {
    return `${input.discoveryChannel}:${input.externalOpportunityId.trim().toLowerCase()}`;
  }
  const name = normalizeResearchCompanyName(input.companyName);
  const host =
    normalizeResearchWebsiteHost(input.website) ??
    normalizeResearchWebsiteHost(input.sourceUrl) ??
    "no-host";
  const trigger =
    input.sourceItemId?.trim().toLowerCase() || slugFragment(input.whyNow);
  return `${input.opportunityKind}:${name}:${host}:${trigger}`;
}

function canAccess(
  row: { ownerEmployeeId: string; reviewerEmployeeIds: string[] },
  actorId: string,
  isAdmin: boolean,
) {
  return (
    isAdmin ||
    row.ownerEmployeeId === actorId ||
    row.reviewerEmployeeIds.includes(actorId)
  );
}

function canSeeExcerpt(
  observation: {
    visibilityScope: string;
    sourceOwnerEmployeeId: string;
  },
  row: { ownerEmployeeId: string; reviewerEmployeeIds: string[] },
  actorId: string,
  isAdmin: boolean,
) {
  if (observation.visibilityScope === "public") return canAccess(row, actorId, isAdmin);
  return (
    isAdmin ||
    row.ownerEmployeeId === actorId ||
    observation.sourceOwnerEmployeeId === actorId ||
    row.reviewerEmployeeIds.includes(actorId)
  );
}

function requireReason(reason: string | undefined, action: string) {
  const value = reason?.trim() ?? "";
  if (value.length < 8) {
    throw new DiscoveryCandidateError(
      "INVALID_INPUT",
      `${action.toUpperCase()}_REASON_REQUIRED`,
    );
  }
  return value;
}

function normalizeOptionalWebsite(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    return normalizeResearchEvidence(value);
  } catch (error) {
    if (error instanceof ResearchEvidenceError) {
      throw new DiscoveryCandidateError(
        "INVALID_INPUT",
        "WEBSITE_MUST_BE_PUBLIC_HTTPS",
      );
    }
    throw error;
  }
}

function normalizeSourceUrl(value: string) {
  try {
    return normalizeResearchEvidence(value);
  } catch (error) {
    if (error instanceof ResearchEvidenceError) {
      throw new DiscoveryCandidateError("INVALID_INPUT", error.message);
    }
    throw error;
  }
}

function observationFromSubmit(
  candidateId: string,
  input: SubmitInput,
  actorId: string,
  sourceUrl: string,
  eventDate: string | null,
): MemoryObservation {
  const excerpt = input.excerpt.trim();
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    candidateId,
    visibilityScope: input.visibilityScope ?? "public",
    sourceOwnerEmployeeId: actorId,
    sourceUrl,
    excerpt,
    excerptHash: sha256(excerpt),
    publishedOrEventDate: eventDate,
    observedAt: now,
    verificationState: eventDate ? "dated" : "needs_evidence",
    redactionState: "none",
    sourceKey: input.sourceKey?.trim() || "operator_submission",
    sourceItemId: input.sourceItemId?.trim() || null,
    contentHash: sha256(
      canonicalJson({
        sourceUrl,
        excerpt,
        eventDate,
      }),
    ),
    supersedesObservationId: null,
    createdAt: now,
  };
}

function laterStageCounts(companyId: string | null) {
  if (!companyId) return { contactCount: 0, dealCount: 0 };
  return Promise.all([
    listContacts({ companyId }),
    listDeals({ companyId }),
  ]).then(([contacts, deals]) => ({
    contactCount: contacts.length,
    dealCount: deals.length,
  }));
}

type CanonicalCompany = {
  companyId: string;
  name: string;
  website: string | null;
};

function resolveCanonicalCompany(
  companies: CanonicalCompany[],
  proposal: { companyName: string; website: string | null },
): CanonicalCompany | null {
  const normalizedName = normalizeResearchCompanyName(proposal.companyName);
  const websiteHost = normalizeResearchWebsiteHost(proposal.website);
  const sameName = companies.filter(
    (company) => normalizeResearchCompanyName(company.name) === normalizedName,
  );
  const sameDomain = websiteHost
    ? companies.filter(
        (company) =>
          normalizeResearchWebsiteHost(company.website) === websiteHost,
      )
    : [];
  const conflictingName = Boolean(
    websiteHost &&
      sameName.some((company) => {
        const existingHost = normalizeResearchWebsiteHost(company.website);
        return Boolean(existingHost && existingHost !== websiteHost);
      }),
  );
  const conflictingDomain = sameDomain.some(
    (company) => normalizeResearchCompanyName(company.name) !== normalizedName,
  );
  if (conflictingName || conflictingDomain) {
    throw new DiscoveryCandidateError(
      "COMPANY_IDENTITY_CONFLICT",
      "COMPANY_IDENTITY_CONFLICT_REQUIRES_REVIEW",
    );
  }
  const candidates = new Map<string, CanonicalCompany>();
  for (const company of [...sameName, ...sameDomain]) {
    candidates.set(company.companyId, company);
  }
  if (candidates.size > 1) {
    throw new DiscoveryCandidateError(
      "COMPANY_IDENTITY_AMBIGUOUS",
      "COMPANY_IDENTITY_AMBIGUOUS_REQUIRES_LINK",
    );
  }
  return [...candidates.values()][0] ?? null;
}

function matchingCompaniesFor(
  companies: CanonicalCompany[],
  proposal: { companyName: string; website: string | null },
) {
  const normalizedName = normalizeResearchCompanyName(proposal.companyName);
  const websiteHost = normalizeResearchWebsiteHost(proposal.website);
  return companies
    .filter(
      (company) =>
        normalizeResearchCompanyName(company.name) === normalizedName ||
        (websiteHost &&
          normalizeResearchWebsiteHost(company.website) === websiteHost),
    )
    .map((company) => ({
      companyId: company.companyId,
      name: company.name,
      website: company.website,
    }));
}

function withDecisionLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = decisionLocks.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  decisionLocks.set(key, tail);
  try {
    return run;
  } finally {
    if (decisionLocks.get(key) === tail) decisionLocks.delete(key);
  }
}

function recordMemoryAudit(entry: DiscoveryCandidateAudit) {
  memoryAudits.push(entry);
}

function observationView(
  observation: MemoryObservation,
  candidate: Pick<MemoryCandidate, "ownerEmployeeId" | "reviewerEmployeeIds">,
  actorId: string,
  isAdmin: boolean,
) {
  const visible = canSeeExcerpt(observation, candidate, actorId, isAdmin);
  const redacted = observation.redactionState !== "none";
  return {
    id: observation.id,
    visibilityScope: observation.visibilityScope,
    sourceUrl: visible ? observation.sourceUrl : null,
    excerpt: visible && !redacted ? observation.excerpt : null,
    excerptHidden: !visible || redacted,
    excerptHash: observation.excerptHash,
    eventDate: observation.publishedOrEventDate,
    verificationState: observation.verificationState,
    redactionState: observation.redactionState,
    sourceKey: observation.sourceKey,
    createdAt: observation.createdAt,
  };
}

async function evaluateCandidateEvidence(
  row: Pick<
    MemoryCandidate,
    | "opportunityKind"
    | "whyNow"
    | "companyName"
    | "website"
    | "sourceKey"
    | "observations"
  >,
  extras?: {
    excerpt?: string;
    eventDate?: string | null;
    sourceUrl?: string | null;
    visibilityScope?: DiscoveryVisibility;
    identityLineage?: DiscoveryIdentityLineage;
  },
) {
  const latest = row.observations[0];
  return evaluateDiscoveryEvidence({
    opportunityKind: row.opportunityKind,
    excerpt: extras?.excerpt ?? latest?.excerpt ?? "",
    whyNow: row.whyNow,
    eventDate: extras?.eventDate ?? latest?.publishedOrEventDate ?? null,
    visibilityScope: extras?.visibilityScope ?? latest?.visibilityScope ?? "public",
    companyName: row.companyName,
    website: row.website,
    sourceUrl: extras?.sourceUrl ?? latest?.sourceUrl ?? null,
    evidenceId: latest?.id,
    sourceKey: row.sourceKey,
    route: discoveryEvidenceRoute(row.sourceKey),
    identityLineage: extras?.identityLineage,
  });
}

async function loadStoredIdentityLineage(
  query: DiscoveryQuery | undefined,
  scheduledJobId: string | null,
  observationId: string,
  sourceKey: string | null,
): Promise<DiscoveryIdentityLineage | undefined> {
  if (!query || !scheduledJobId) return undefined;
  const [job] = await query
    .select({
      scheduledJobId: scheduledJob.scheduledJobId,
      result: scheduledJob.result,
    })
    .from(scheduledJob)
    .where(eq(scheduledJob.scheduledJobId, scheduledJobId))
    .limit(1);
  if (!job || job.scheduledJobId !== scheduledJobId) return undefined;
  return (
    readStoredDiscoveryIdentityLineage(job.result, observationId, {
      sourceKey,
    }) ?? undefined
  );
}

async function candidateView(
  row: MemoryCandidate,
  actorId: string,
  isAdmin: boolean,
  includeEvidence: boolean,
  knownCompanies?: CanonicalCompany[],
  evaluationOverride?: DiscoveryEvidenceEvaluation,
  identityLineage?: DiscoveryIdentityLineage,
) {
  const companies =
    knownCompanies ??
    (await listCompanies()).map((company) => ({
      companyId: company.companyId,
      name: company.name,
      website: company.website,
    }));
  const latest = row.observations[0];
  const excerptVisible = latest
    ? canSeeExcerpt(latest, row, actorId, isAdmin) &&
      latest.redactionState === "none"
    : false;
  const evaluation = includeEvidence
    ? evaluationOverride ??
      (excerptVisible
        ? await evaluateCandidateEvidence(row, { identityLineage })
        : redactHiddenEvaluation(
            await evaluateCandidateEvidence(row, { identityLineage }),
          ))
    : undefined;
  return {
    id: row.id,
    requestId: row.requestId,
    opportunityKey: row.opportunityKey,
    companyName: row.companyName,
    website: row.website,
    sector: row.sector,
    market: row.market,
    strategicLane: row.strategicLane,
    discoveryChannel: row.discoveryChannel,
    opportunityKind: row.opportunityKind,
    whyNow: row.whyNow,
    relevantService: row.relevantService,
    missingFacts: row.missingFacts,
    knownRelationship: row.knownRelationship,
    sourceKey: row.sourceKey,
    reviewState: row.reviewState,
    decisionReason: row.decisionReason,
    qualificationState: row.qualificationState,
    expectedVersion: row.expectedVersion,
    ownerEmployeeId: row.ownerEmployeeId,
    programmeId: row.programmeId,
    companyId: row.companyId,
    executionEnabled: false as const,
    candidateStoreAccepted: false as const,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    matchingCompanies: matchingCompaniesFor(companies, row),
    evaluation,
    evidence: includeEvidence
      ? row.observations.map((observation) =>
          observationView(observation, row, actorId, isAdmin),
        )
      : undefined,
  };
}

function assertAccess(
  row: Pick<MemoryCandidate, "ownerEmployeeId" | "reviewerEmployeeIds">,
  actorId: string,
  isAdmin: boolean,
) {
  if (!canAccess(row, actorId, isAdmin)) {
    throw new DiscoveryCandidateError("FORBIDDEN", "CANDIDATE_ACCESS_DENIED");
  }
}

function assertVersion(row: MemoryCandidate, expectedVersion: number) {
  if (row.expectedVersion !== expectedVersion) {
    throw new DiscoveryCandidateError("CONFLICT", "CANDIDATE_VERSION_CONFLICT");
  }
}

function openStates(): DiscoveryReviewState[] {
  return ["needs_review", "needs_evidence", "parked", "corrected", "accepted"];
}

function findOpenByKey(opportunityKey: string) {
  return [...memoryCandidates.values()].find(
    (row) =>
      row.opportunityKey === opportunityKey &&
      openStates().includes(row.reviewState),
  );
}

async function ownershipFromProgramme(
  programmeId: string | undefined,
  actorId: string,
  isAdmin: boolean,
) {
  if (!programmeId) {
    return {
      ownerEmployeeId: actorId,
      reviewerEmployeeIds: [] as string[],
      programmeId: null,
    };
  }
  const programme = await getDiscoveryProgramme({
    programmeId,
    actorEmployeeId: actorId,
    isAdmin,
  });
  return {
    ownerEmployeeId: programme.ownerEmployeeId,
    reviewerEmployeeIds: programme.reviewerEmployeeIds,
    programmeId: programme.id,
  };
}

export async function submitDiscoveryCandidate(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
  values: SubmitInput;
}) {
  const values = discoveryCandidateSubmitSchema.parse(input.values);
  const sourceUrl = normalizeSourceUrl(values.sourceUrl);
  const website = normalizeOptionalWebsite(values.website);
  const eventDate = values.eventDate ?? null;
  const opportunityKey = buildDiscoveryOpportunityKey({
    ...values,
    website,
    sourceUrl,
    whyNow: values.whyNow,
  });
  const payloadHash = sha256(
    canonicalJson({
      ...values,
      sourceUrl,
      website,
      excerpt: values.excerpt.trim(),
    }),
  );
  const evaluation = await evaluateDiscoveryEvidence({
    opportunityKind: values.opportunityKind,
    excerpt: values.excerpt,
    whyNow: values.whyNow,
    eventDate,
    visibilityScope: values.visibilityScope ?? "public",
    companyName: values.companyName,
    website,
    sourceUrl,
    evidenceId: values.requestId,
    sourceKey: values.sourceKey,
    route: discoveryEvidenceRoute(values.sourceKey),
    identityLineage: {
      observationId: values.requestId,
      semantic: "manual",
      provider: "unavailable",
      model: null,
      requestId: null,
      identity: { name: values.companyName.trim() },
      sourceUrl: sourceUrl ?? "",
      excerptHash: sha256(values.excerpt.trim()),
      grounded: isCompanyNameGroundedInExcerpt(
        values.companyName,
        values.excerpt,
      ),
    },
  });
  const reviewState = evaluation.reviewState;
  const missingFacts =
    values.missingFacts?.trim() ||
    (evaluation.reasons.length ? evaluation.reasons.join("; ") : null);
  const initialDecisionReason =
    evaluation.disposition === "awarded"
      ? evaluation.reasons[0] ??
        "Already-awarded appointment is intelligence, not an open pitch"
      : null;
  const ownership = await ownershipFromProgramme(
    values.programmeId,
    input.actorEmployeeId,
    input.isAdmin,
  );
  const db = getDb();
  if (!db) {
    const existingId = memoryByRequest.get(values.requestId);
    if (existingId) {
      const existing = memoryCandidates.get(existingId);
      if (!existing)
        throw new DiscoveryCandidateError("NOT_FOUND", "CANDIDATE_NOT_FOUND");
      if (existing.payloadHash !== payloadHash) {
        throw new DiscoveryCandidateError(
          "REPLAY_CONFLICT",
          "CANDIDATE_REQUEST_REPLAY_CONFLICT",
        );
      }
      assertAccess(existing, input.actorEmployeeId, input.isAdmin);
      return candidateView(existing, input.actorEmployeeId, input.isAdmin, true);
    }
    const duplicate = findOpenByKey(opportunityKey);
    if (duplicate) {
      assertAccess(duplicate, input.actorEmployeeId, input.isAdmin);
      const view = await candidateView(
        duplicate,
        input.actorEmployeeId,
        input.isAdmin,
        true,
      );
      return view.evaluation
        ? { ...view, evaluation: markDuplicateEvaluation(view.evaluation) }
        : view;
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const observation = observationFromSubmit(
      id,
      values,
      input.actorEmployeeId,
      sourceUrl,
      eventDate,
    );
    const row: MemoryCandidate = {
      id,
      requestId: values.requestId,
      payloadHash,
      opportunityKey,
      companyName: values.companyName.trim(),
      website,
      sector: values.sector?.trim() || null,
      market: values.market,
      strategicLane: values.strategicLane,
      discoveryChannel: values.discoveryChannel,
      opportunityKind: values.opportunityKind,
      whyNow: values.whyNow.trim(),
      relevantService: values.relevantService?.trim() || null,
      missingFacts,
      knownRelationship: values.knownRelationship?.trim() || null,
      sourceKey: values.sourceKey?.trim() || "operator_submission",
      sourceItemId: values.sourceItemId?.trim() || null,
      externalOpportunityId: values.externalOpportunityId?.trim() || null,
      reviewState,
      decisionReason: initialDecisionReason,
      qualificationState: "not_assessed",
      expectedVersion: 1,
      ownerEmployeeId: ownership.ownerEmployeeId,
      reviewerEmployeeIds: ownership.reviewerEmployeeIds,
      programmeId: ownership.programmeId,
      runId: null,
      companyId: null,
      createdByEmployeeId: input.actorEmployeeId,
      decidedByEmployeeId: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
      observations: [observation],
    };
    memoryCandidates.set(id, row);
    memoryByRequest.set(values.requestId, id);
    recordMemoryAudit({
      action: "discovery.candidate.submitted",
      entityId: id,
      actorEmployeeId: input.actorEmployeeId,
      before: {},
      after: {
        reviewState,
        opportunityKey,
        observationId: observation.id,
        excerptHash: observation.excerptHash,
        visibilityScope: observation.visibilityScope,
      },
      reason: "Operator submitted evidenced Discovery candidate",
    });
    return candidateView(row, input.actorEmployeeId, input.isAdmin, true);
  }

  return db.transaction(async (tx) => {
    const [replay] = await tx
      .select()
      .from(discoveryCandidate)
      .where(eq(discoveryCandidate.requestId, values.requestId))
      .limit(1);
    if (replay) {
      if (replay.payloadHash !== payloadHash) {
        throw new DiscoveryCandidateError(
          "REPLAY_CONFLICT",
          "CANDIDATE_REQUEST_REPLAY_CONFLICT",
        );
      }
      assertAccess(replay, input.actorEmployeeId, input.isAdmin);
      return loadDbView(tx, replay.discoveryCandidateId, input, true);
    }
    const [duplicate] = await tx
      .select()
      .from(discoveryCandidate)
      .where(
        and(
          eq(discoveryCandidate.opportunityKey, opportunityKey),
          sql`${discoveryCandidate.reviewState} in ('needs_review', 'needs_evidence', 'parked', 'corrected', 'accepted')`,
        ),
      )
      .limit(1);
    if (duplicate) {
      assertAccess(duplicate, input.actorEmployeeId, input.isAdmin);
      const view = await loadDbView(
        tx,
        duplicate.discoveryCandidateId,
        input,
        true,
      );
      return view.evaluation
        ? { ...view, evaluation: markDuplicateEvaluation(view.evaluation) }
        : view;
    }
    const excerpt = values.excerpt.trim();
    const excerptHash = sha256(excerpt);
    const contentHash = sha256(
      canonicalJson({ sourceUrl, excerpt, eventDate }),
    );
    const [created] = await tx
      .insert(discoveryCandidate)
      .values({
        requestId: values.requestId,
        payloadHash,
        opportunityKey,
        companyName: values.companyName.trim(),
        website,
        sector: values.sector?.trim() || null,
        market: values.market,
        strategicLane: values.strategicLane,
        discoveryChannel: values.discoveryChannel,
        opportunityKind: values.opportunityKind,
        whyNow: values.whyNow.trim(),
        relevantService: values.relevantService?.trim() || null,
        missingFacts,
        knownRelationship: values.knownRelationship?.trim() || null,
        sourceKey: values.sourceKey?.trim() || "operator_submission",
        sourceItemId: values.sourceItemId?.trim() || null,
        externalOpportunityId: values.externalOpportunityId?.trim() || null,
        reviewState,
        decisionReason: initialDecisionReason,
        qualificationState: "not_assessed",
        expectedVersion: 1,
        ownerEmployeeId: ownership.ownerEmployeeId,
        reviewerEmployeeIds: ownership.reviewerEmployeeIds,
        researchProgrammeId: ownership.programmeId,
        createdByEmployeeId: input.actorEmployeeId,
      })
      .returning();
    if (!created)
      throw new DiscoveryCandidateError("CONFLICT", "CANDIDATE_CREATE_FAILED");
    const [observation] = await tx
      .insert(discoveryObservation)
      .values({
        discoveryCandidateId: created.discoveryCandidateId,
        visibilityScope: values.visibilityScope,
        sourceOwnerEmployeeId: input.actorEmployeeId,
        sourceUrl,
        excerpt,
        excerptHash,
        publishedOrEventDate: eventDate,
        verificationState: eventDate ? "dated" : "needs_evidence",
        sourceKey: values.sourceKey?.trim() || "operator_submission",
        sourceItemId: values.sourceItemId?.trim() || null,
        contentHash,
      })
      .returning();
    await tx.insert(auditEvent).values({
      actorEmployeeId: input.actorEmployeeId,
      action: "discovery.candidate.submitted",
      entityType: "discovery_candidate",
      entityId: created.discoveryCandidateId,
      before: {},
      after: {
        reviewState,
        opportunityKey,
        observationId: observation?.discoveryObservationId ?? null,
        excerptHash,
        visibilityScope: values.visibilityScope,
      },
      reason: "Operator submitted evidenced Discovery candidate",
    });
    return loadDbView(tx, created.discoveryCandidateId, input, true);
  });
}

export async function countDiscoveryCandidatesForRunTx(
  tx: DiscoveryWriteTx,
  scheduledJobId: string,
) {
  const [row] = await tx
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(discoveryCandidate)
    .where(eq(discoveryCandidate.scheduledJobId, scheduledJobId));
  return row?.count ?? 0;
}

export async function ingestCollectorObservationTx(
  tx: DiscoveryWriteTx,
  input: {
    actorEmployeeId: string;
    ownerEmployeeId: string;
    reviewerEmployeeIds: string[];
    programmeId: string;
    scheduledJobId: string;
    values: SubmitInput;
    evaluation?: DiscoveryEvidenceEvaluation;
  },
): Promise<{
  status: CollectorIngestStatus;
  candidateId?: string;
  reason?: string;
}> {
  const values = discoveryCandidateSubmitSchema.parse(input.values);
  const sourceUrl = normalizeSourceUrl(values.sourceUrl);
  const website = normalizeOptionalWebsite(values.website);
  const eventDate = values.eventDate ?? null;
  const opportunityKey = buildDiscoveryOpportunityKey({
    ...values,
    website,
    sourceUrl,
    whyNow: values.whyNow,
  });
  const payloadHash = sha256(
    canonicalJson({
      ...values,
      sourceUrl,
      website,
      excerpt: values.excerpt.trim(),
    }),
  );
  const evaluation =
    input.evaluation ??
    (await evaluateDiscoveryEvidence({
      opportunityKind: values.opportunityKind,
      excerpt: values.excerpt,
      whyNow: values.whyNow,
      eventDate,
      visibilityScope: values.visibilityScope ?? "public",
      companyName: values.companyName,
      website,
      sourceUrl,
      evidenceId: values.requestId,
      sourceKey: values.sourceKey,
      route: "automated",
    }));
  const [replay] = await tx
    .select()
    .from(discoveryCandidate)
    .where(eq(discoveryCandidate.requestId, values.requestId))
    .limit(1);
  if (replay) {
    if (replay.payloadHash !== payloadHash)
      return {
        status: "quarantined",
        candidateId: replay.discoveryCandidateId,
        reason: "CANDIDATE_REQUEST_REPLAY_CONFLICT",
      };
    return { status: "replay", candidateId: replay.discoveryCandidateId };
  }
  const [duplicate] = await tx
    .select()
    .from(discoveryCandidate)
    .where(
      and(
        eq(discoveryCandidate.opportunityKey, opportunityKey),
        sql`${discoveryCandidate.reviewState} in ('needs_review', 'needs_evidence', 'parked', 'corrected', 'accepted')`,
      ),
    )
    .limit(1);
  if (duplicate)
    return { status: "duplicate", candidateId: duplicate.discoveryCandidateId };
  const excerpt = values.excerpt.trim();
  const excerptHash = sha256(excerpt);
  const contentHash = sha256(
    canonicalJson({ sourceUrl, excerpt, eventDate }),
  );
  const [created] = await tx
    .insert(discoveryCandidate)
    .values({
      requestId: values.requestId,
      payloadHash,
      opportunityKey,
      companyName: values.companyName.trim(),
      website,
      sector: values.sector?.trim() || null,
      market: values.market,
      strategicLane: values.strategicLane,
      discoveryChannel: values.discoveryChannel,
      opportunityKind: values.opportunityKind,
      whyNow: values.whyNow.trim(),
      relevantService: values.relevantService?.trim() || null,
      missingFacts:
        values.missingFacts?.trim() ||
        (evaluation.reasons.length ? evaluation.reasons.join("; ") : null),
      knownRelationship: values.knownRelationship?.trim() || null,
      sourceKey: values.sourceKey?.trim() || "campaign_me",
      sourceItemId: values.sourceItemId?.trim() || null,
      externalOpportunityId: values.externalOpportunityId?.trim() || null,
      reviewState: evaluation.reviewState,
      decisionReason:
        evaluation.disposition === "awarded"
          ? evaluation.reasons[0] ??
            "Already-awarded appointment is intelligence, not an open pitch"
          : null,
      qualificationState: "not_assessed",
      expectedVersion: 1,
      ownerEmployeeId: input.ownerEmployeeId,
      reviewerEmployeeIds: input.reviewerEmployeeIds,
      researchProgrammeId: input.programmeId,
      scheduledJobId: input.scheduledJobId,
      createdByEmployeeId: input.actorEmployeeId,
    })
    .returning();
  if (!created)
    return { status: "quarantined", reason: "CANDIDATE_CREATE_FAILED" };
  const [observation] = await tx
    .insert(discoveryObservation)
    .values({
      discoveryCandidateId: created.discoveryCandidateId,
      visibilityScope: values.visibilityScope ?? "public",
      sourceOwnerEmployeeId: input.actorEmployeeId,
      sourceUrl,
      excerpt,
      excerptHash,
      publishedOrEventDate: eventDate,
      verificationState: eventDate ? "dated" : "needs_evidence",
      sourceKey: values.sourceKey?.trim() || "campaign_me",
      sourceItemId: values.sourceItemId?.trim() || null,
      contentHash,
    })
    .returning();
  await tx.insert(auditEvent).values({
    actorEmployeeId: input.actorEmployeeId,
    action: "discovery.candidate.collector_ingested",
    entityType: "discovery_candidate",
    entityId: created.discoveryCandidateId,
    before: {},
    after: {
      reviewState: evaluation.reviewState,
      opportunityKey,
      observationId: observation?.discoveryObservationId ?? null,
      excerptHash,
      visibilityScope: values.visibilityScope ?? "public",
      scheduledJobId: input.scheduledJobId,
      route: "automated",
    },
    reason: "Signed public-news callback ingested a Discovery observation",
  });
  return { status: "ingested", candidateId: created.discoveryCandidateId };
}

type Actor = { actorEmployeeId: string; isAdmin: boolean };

async function loadDbView(
  db: DiscoveryQuery,
  candidateId: string,
  actor: Actor,
  includeEvidence: boolean,
) {
  const [row] = await db
    .select()
    .from(discoveryCandidate)
    .where(eq(discoveryCandidate.discoveryCandidateId, candidateId))
    .limit(1);
  if (!row)
    throw new DiscoveryCandidateError("NOT_FOUND", "CANDIDATE_NOT_FOUND");
  const observations = includeEvidence
    ? await db
        .select()
        .from(discoveryObservation)
        .where(eq(discoveryObservation.discoveryCandidateId, candidateId))
        .orderBy(desc(discoveryObservation.createdAt))
    : [];
  return dbRowView(row, observations, actor, includeEvidence, db);
}

async function dbRowView(
  row: typeof discoveryCandidate.$inferSelect,
  observations: Array<typeof discoveryObservation.$inferSelect>,
  actor: Actor,
  includeEvidence: boolean,
  query?: DiscoveryQuery,
) {
  const companies = query
    ? await query
        .select({
          companyId: companyTable.companyId,
          name: companyTable.name,
          website: companyTable.website,
        })
        .from(companyTable)
    : (await listCompanies()).map((company) => ({
        companyId: company.companyId,
        name: company.name,
        website: company.website,
      }));
  const memoryLike: MemoryCandidate = {
    id: row.discoveryCandidateId,
    requestId: row.requestId,
    payloadHash: row.payloadHash,
    opportunityKey: row.opportunityKey,
    companyName: row.companyName,
    website: row.website,
    sector: row.sector,
    market: (row.market as CrmMarket) ?? "UAE",
    strategicLane: row.strategicLane as MemoryCandidate["strategicLane"],
    discoveryChannel: row.discoveryChannel as MemoryCandidate["discoveryChannel"],
    opportunityKind: row.opportunityKind as MemoryCandidate["opportunityKind"],
    whyNow: row.whyNow,
    relevantService: row.relevantService,
    missingFacts: row.missingFacts,
    knownRelationship: row.knownRelationship,
    sourceKey: row.sourceKey,
    sourceItemId: row.sourceItemId,
    externalOpportunityId: row.externalOpportunityId,
    reviewState: row.reviewState as DiscoveryReviewState,
    decisionReason: row.decisionReason,
    qualificationState: "not_assessed",
    expectedVersion: row.expectedVersion,
    ownerEmployeeId: row.ownerEmployeeId,
    reviewerEmployeeIds: row.reviewerEmployeeIds ?? [],
    programmeId: row.researchProgrammeId,
    runId: row.scheduledJobId,
    companyId: row.companyId,
    createdByEmployeeId: row.createdByEmployeeId,
    decidedByEmployeeId: row.decidedByEmployeeId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    observations: observations.map((observation) => ({
      id: observation.discoveryObservationId,
      candidateId: observation.discoveryCandidateId,
      visibilityScope: observation.visibilityScope as DiscoveryVisibility,
      sourceOwnerEmployeeId: observation.sourceOwnerEmployeeId,
      sourceUrl: observation.sourceUrl,
      excerpt: observation.excerpt,
      excerptHash: observation.excerptHash,
      publishedOrEventDate: observation.publishedOrEventDate,
      observedAt: observation.observedAt.toISOString(),
      verificationState:
        observation.verificationState as MemoryObservation["verificationState"],
      redactionState:
        observation.redactionState as MemoryObservation["redactionState"],
      sourceKey: observation.sourceKey,
      sourceItemId: observation.sourceItemId,
      contentHash: observation.contentHash,
      supersedesObservationId: observation.supersedesObservationId,
      createdAt: observation.createdAt.toISOString(),
    })),
  };
  const latestObservation = observations[0];
  const identityLineage = includeEvidence
    ? row.scheduledJobId
      ? await loadStoredIdentityLineage(
          query,
          row.scheduledJobId,
          row.requestId,
          row.sourceKey,
        )
      : latestObservation
        ? {
            observationId: row.requestId,
            semantic: "manual" as const,
            provider: "unavailable",
            model: null,
            requestId: null,
            identity: { name: row.companyName },
            sourceUrl: latestObservation.sourceUrl ?? "",
            excerptHash: latestObservation.excerptHash,
            grounded: isCompanyNameGroundedInExcerpt(
              row.companyName,
              latestObservation.excerpt,
            ),
          }
        : undefined
    : undefined;
  return candidateView(
    memoryLike,
    actor.actorEmployeeId,
    actor.isAdmin,
    includeEvidence,
    companies,
    undefined,
    identityLineage,
  );
}

function queueMatches(state: DiscoveryReviewState, queue: DiscoveryQueue) {
  return queue === "all" || state === queue;
}

export async function listDiscoveryCandidates(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
  queue?: DiscoveryQueue;
}) {
  const queue = input.queue ?? "needs_review";
  const db = getDb();
  if (!db) {
    const rows = [...memoryCandidates.values()]
      .filter((row) => canAccess(row, input.actorEmployeeId, input.isAdmin))
      .filter((row) => queueMatches(row.reviewState, queue))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return Promise.all(
      rows.map((row) =>
        candidateView(row, input.actorEmployeeId, input.isAdmin, false),
      ),
    );
  }
  const access = input.isAdmin
    ? undefined
    : sql`(
        ${discoveryCandidate.ownerEmployeeId} = ${input.actorEmployeeId}::uuid
        or ${input.actorEmployeeId}::uuid = any(${discoveryCandidate.reviewerEmployeeIds})
      )`;
  const stateFilter =
    queue === "all"
      ? undefined
      : eq(discoveryCandidate.reviewState, queue);
  const rows = await db
    .select()
    .from(discoveryCandidate)
    .where(
      access && stateFilter
        ? and(access, stateFilter)
        : (access ?? stateFilter),
    )
    .orderBy(desc(discoveryCandidate.updatedAt));
  return Promise.all(
    rows.map((row) => dbRowView(row, [], input, false, db)),
  );
}

export async function getDiscoveryCandidate(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
  candidateId: string;
}) {
  const db = getDb();
  if (!db) {
    const row = memoryCandidates.get(input.candidateId);
    if (!row)
      throw new DiscoveryCandidateError("NOT_FOUND", "CANDIDATE_NOT_FOUND");
    assertAccess(row, input.actorEmployeeId, input.isAdmin);
    return candidateView(row, input.actorEmployeeId, input.isAdmin, true);
  }
  const [row] = await db
    .select()
    .from(discoveryCandidate)
    .where(eq(discoveryCandidate.discoveryCandidateId, input.candidateId))
    .limit(1);
  if (!row)
    throw new DiscoveryCandidateError("NOT_FOUND", "CANDIDATE_NOT_FOUND");
  assertAccess(row, input.actorEmployeeId, input.isAdmin);
  const observations = await db
    .select()
    .from(discoveryObservation)
    .where(
      eq(
        discoveryObservation.discoveryCandidateId,
        input.candidateId,
      ),
    )
    .orderBy(desc(discoveryObservation.createdAt));
  return dbRowView(row, observations, input, true, db);
}

export async function countDiscoveryReviewQueues(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
}) {
  const rows = await listDiscoveryCandidates({
    ...input,
    queue: "all",
  });
  return {
    needsReview: rows.filter((row) => row.reviewState === "needs_review")
      .length,
    needsEvidence: rows.filter((row) => row.reviewState === "needs_evidence")
      .length,
  };
}

function assertOpenForDecision(
  row: MemoryCandidate,
  action: DecideInput["action"],
) {
  if (action === "accept" || action === "link") {
    if (
      row.reviewState !== "needs_review" &&
      row.reviewState !== "corrected" &&
      row.reviewState !== "parked" &&
      row.reviewState !== "accepted"
    ) {
      throw new DiscoveryCandidateError(
        "INVALID_STATE",
        "CANDIDATE_NOT_READY_FOR_ACCEPT",
      );
    }
    return;
  }
  if (row.reviewState === "rejected") {
    throw new DiscoveryCandidateError("INVALID_STATE", "CANDIDATE_REJECTED");
  }
}

async function promoteCompany(input: {
  row: MemoryCandidate;
  companyId?: string;
  actorId: string;
}) {
  if (input.companyId) {
    const existing = await getCompany(input.companyId);
    if (!existing)
      throw new DiscoveryCandidateError("NOT_FOUND", "COMPANY_NOT_FOUND");
    if (input.row.companyId && input.row.companyId !== existing.companyId) {
      throw new DiscoveryCandidateError(
        "COMPANY_LINK_CONFLICT",
        "CANDIDATE_ALREADY_LINKED_TO_OTHER_COMPANY",
      );
    }
    return existing.companyId;
  }
  const companies = (await listCompanies()).map((company) => ({
    companyId: company.companyId,
    name: company.name,
    website: company.website,
  }));
  const resolved = resolveCanonicalCompany(companies, input.row);
  if (resolved) {
    if (input.row.companyId && input.row.companyId !== resolved.companyId) {
      throw new DiscoveryCandidateError(
        "COMPANY_LINK_CONFLICT",
        "CANDIDATE_ALREADY_LINKED_TO_OTHER_COMPANY",
      );
    }
    return resolved.companyId;
  }
  const created = await createCompany({
    name: input.row.companyName,
    sector: input.row.sector,
    market: input.row.market,
    website: input.row.website,
    notes: null,
  });
  return created.companyId;
}

async function applyMemoryDecision(
  input: DecideInput & Actor,
): Promise<Awaited<ReturnType<typeof candidateView>>> {
  const row = memoryCandidates.get(input.candidateId);
  if (!row)
    throw new DiscoveryCandidateError("NOT_FOUND", "CANDIDATE_NOT_FOUND");
  assertAccess(row, input.actorEmployeeId, input.isAdmin);
  assertVersion(row, input.expectedVersion);
  assertOpenForDecision(row, input.action);
  const before = {
    reviewState: row.reviewState,
    companyId: row.companyId,
    expectedVersion: row.expectedVersion,
  };
  const now = new Date().toISOString();

  switch (input.action) {
    case "accept":
    case "link": {
      const companyId = await promoteCompany({
        row,
        companyId: input.action === "link" ? input.companyId : undefined,
        actorId: input.actorEmployeeId,
      });
      if (row.reviewState === "accepted" && row.companyId === companyId) {
        return candidateView(row, input.actorEmployeeId, input.isAdmin, true);
      }
      row.companyId = companyId;
      row.reviewState = "accepted";
      row.decisionReason = input.reason?.trim() || "Accepted for qualification";
      row.decidedByEmployeeId = input.actorEmployeeId;
      row.decidedAt = now;
      row.expectedVersion += 1;
      row.updatedAt = now;
      row.qualificationState = "not_assessed";
      const later = await laterStageCounts(companyId);
      if (later.contactCount > 0 || later.dealCount > 0) {
        throw new DiscoveryCandidateError(
          "CONFLICT",
          "DISCOVERY_MUST_NOT_CREATE_LATER_STAGE_RECORDS",
        );
      }
      recordMemoryAudit({
        action:
          input.action === "link"
            ? "discovery.candidate.linked"
            : "discovery.candidate.accepted",
        entityId: row.id,
        actorEmployeeId: input.actorEmployeeId,
        before,
        after: {
          reviewState: row.reviewState,
          companyId,
          expectedVersion: row.expectedVersion,
          contactCount: 0,
          dealCount: 0,
        },
        reason: row.decisionReason,
      });
      return candidateView(row, input.actorEmployeeId, input.isAdmin, true);
    }
    case "park":
    case "reject":
    case "request_evidence": {
      const reason = requireReason(input.reason, input.action);
      row.reviewState =
        input.action === "park"
          ? "parked"
          : input.action === "reject"
            ? "rejected"
            : "needs_evidence";
      row.decisionReason = reason;
      row.decidedByEmployeeId = input.actorEmployeeId;
      row.decidedAt = now;
      row.expectedVersion += 1;
      row.updatedAt = now;
      recordMemoryAudit({
        action: `discovery.candidate.${input.action}`,
        entityId: row.id,
        actorEmployeeId: input.actorEmployeeId,
        before,
        after: {
          reviewState: row.reviewState,
          expectedVersion: row.expectedVersion,
        },
        reason,
      });
      return candidateView(row, input.actorEmployeeId, input.isAdmin, true);
    }
    case "correct": {
      const reason = requireReason(input.reason, input.action);
      let nextReason = reason;
      const nextName = input.companyName?.trim() || row.companyName;
      const nextWebsite =
        input.website !== undefined
          ? normalizeOptionalWebsite(input.website)
          : row.website;
      const nextWhy = input.whyNow?.trim() || row.whyNow;
      const nextKey = buildDiscoveryOpportunityKey({
        discoveryChannel: row.discoveryChannel,
        opportunityKind: row.opportunityKind,
        companyName: nextName,
        website: nextWebsite,
        sourceUrl: row.observations[0]?.sourceUrl ?? null,
        sourceItemId: row.sourceItemId,
        externalOpportunityId: row.externalOpportunityId,
        whyNow: nextWhy,
      });
      const collision = findOpenByKey(nextKey);
      if (collision && collision.id !== row.id) {
        throw new DiscoveryCandidateError(
          "CONFLICT",
          "OPPORTUNITY_KEY_CONFLICT",
        );
      }
      row.companyName = nextName;
      row.website = nextWebsite;
      row.whyNow = nextWhy;
      row.relevantService =
        input.relevantService !== undefined
          ? input.relevantService.trim() || null
          : row.relevantService;
      row.missingFacts =
        input.missingFacts !== undefined
          ? input.missingFacts.trim() || null
          : row.missingFacts;
      row.knownRelationship =
        input.knownRelationship !== undefined
          ? input.knownRelationship.trim() || null
          : row.knownRelationship;
      row.opportunityKey = nextKey;
      if (input.excerpt || input.sourceUrl || input.eventDate !== undefined) {
        const latest = row.observations[0];
        const sourceUrl = input.sourceUrl
          ? normalizeSourceUrl(input.sourceUrl)
          : latest?.sourceUrl;
        if (!sourceUrl) {
          throw new DiscoveryCandidateError(
            "INVALID_INPUT",
            "EVIDENCE_SOURCE_REQUIRED",
          );
        }
        const excerpt = (input.excerpt ?? latest?.excerpt ?? "").trim();
        if (excerpt.length < 8) {
          throw new DiscoveryCandidateError(
            "INVALID_INPUT",
            "EVIDENCE_EXCERPT_REQUIRED",
          );
        }
        const eventDate =
          input.eventDate === undefined
            ? latest?.publishedOrEventDate ?? null
            : input.eventDate;
        const observation = observationFromSubmit(
          row.id,
          {
            ...discoveryCandidateSubmitSchema.parse({
              requestId: randomUUID(),
              companyName: row.companyName,
              whyNow: row.whyNow,
              sourceUrl,
              excerpt,
              visibilityScope:
                input.visibilityScope ?? latest?.visibilityScope ?? "public",
              eventDate: eventDate ?? undefined,
              discoveryChannel: row.discoveryChannel,
              opportunityKind: row.opportunityKind,
            }),
          },
          input.actorEmployeeId,
          sourceUrl,
          eventDate,
        );
        observation.supersedesObservationId = latest?.id ?? null;
        row.observations.unshift(observation);
        const correctedEval = await evaluateDiscoveryEvidence({
          opportunityKind: row.opportunityKind,
          excerpt,
          whyNow: row.whyNow,
          eventDate,
          visibilityScope:
            input.visibilityScope ?? latest?.visibilityScope ?? "public",
          companyName: row.companyName,
          website: row.website,
          sourceUrl,
          evidenceId: observation.id,
          sourceKey: row.sourceKey,
        });
        row.reviewState = correctedEval.reviewState;
        if (correctedEval.disposition === "awarded") {
          nextReason = correctedEval.reasons[0] ?? reason;
        }
        if (!row.missingFacts && correctedEval.reasons.length) {
          row.missingFacts = correctedEval.reasons.join("; ");
        }
      } else {
        row.reviewState =
          row.reviewState === "accepted" ? "needs_review" : "corrected";
      }
      row.decisionReason = nextReason;
      row.decidedByEmployeeId = input.actorEmployeeId;
      row.decidedAt = now;
      row.expectedVersion += 1;
      row.updatedAt = now;
      recordMemoryAudit({
        action: "discovery.candidate.corrected",
        entityId: row.id,
        actorEmployeeId: input.actorEmployeeId,
        before,
        after: {
          reviewState: row.reviewState,
          opportunityKey: row.opportunityKey,
          expectedVersion: row.expectedVersion,
        },
        reason,
      });
      return candidateView(row, input.actorEmployeeId, input.isAdmin, true);
    }
    default: {
      const unhandled: never = input;
      return unhandled;
    }
  }
}

async function applyPostgresDecision(
  input: DecideInput & Actor,
): Promise<Awaited<ReturnType<typeof candidateView>>> {
  const db = getDb();
  if (!db)
    throw new DiscoveryCandidateError("NOT_FOUND", "CANDIDATE_NOT_FOUND");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`discovery-candidate:${input.candidateId}`}, 0))`,
    );
    const [fresh] = await tx
      .select()
      .from(discoveryCandidate)
      .where(eq(discoveryCandidate.discoveryCandidateId, input.candidateId))
      .limit(1);
    if (!fresh)
      throw new DiscoveryCandidateError("NOT_FOUND", "CANDIDATE_NOT_FOUND");
    assertAccess(fresh, input.actorEmployeeId, input.isAdmin);
    if (fresh.expectedVersion !== input.expectedVersion) {
      throw new DiscoveryCandidateError(
        "CONFLICT",
        "CANDIDATE_VERSION_CONFLICT",
      );
    }
    if (
      (input.action === "accept" || input.action === "link") &&
      fresh.reviewState !== "needs_review" &&
      fresh.reviewState !== "corrected" &&
      fresh.reviewState !== "parked" &&
      fresh.reviewState !== "accepted"
    ) {
      throw new DiscoveryCandidateError(
        "INVALID_STATE",
        "CANDIDATE_NOT_READY_FOR_ACCEPT",
      );
    }
    if (fresh.reviewState === "rejected" && input.action !== "accept" && input.action !== "link") {
      throw new DiscoveryCandidateError("INVALID_STATE", "CANDIDATE_REJECTED");
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`discovery-opportunity:${fresh.opportunityKey}`}, 0))`,
    );
    const before = {
      reviewState: fresh.reviewState,
      companyId: fresh.companyId,
      expectedVersion: fresh.expectedVersion,
    };
    let nextState = fresh.reviewState;
    let companyId = fresh.companyId;
    let reason = input.reason?.trim() || null;
    let nextName = fresh.companyName;
    let nextWebsite = fresh.website;
    let nextWhy = fresh.whyNow;
    let nextService = fresh.relevantService;
    let nextMissing = fresh.missingFacts;
    let nextRelationship = fresh.knownRelationship;
    let nextKey = fresh.opportunityKey;

    switch (input.action) {
      case "accept":
      case "link": {
        if (
          fresh.reviewState !== "needs_review" &&
          fresh.reviewState !== "corrected" &&
          fresh.reviewState !== "parked" &&
          fresh.reviewState !== "accepted"
        ) {
          throw new DiscoveryCandidateError(
            "INVALID_STATE",
            "CANDIDATE_NOT_READY_FOR_ACCEPT",
          );
        }
        if (input.action === "link") {
          const [existing] = await tx
            .select()
            .from(companyTable)
            .where(eq(companyTable.companyId, input.companyId))
            .limit(1);
          if (!existing)
            throw new DiscoveryCandidateError("NOT_FOUND", "COMPANY_NOT_FOUND");
          if (fresh.companyId && fresh.companyId !== existing.companyId) {
            throw new DiscoveryCandidateError(
              "COMPANY_LINK_CONFLICT",
              "CANDIDATE_ALREADY_LINKED_TO_OTHER_COMPANY",
            );
          }
          companyId = existing.companyId;
        } else {
          const companies = await tx
            .select({
              companyId: companyTable.companyId,
              name: companyTable.name,
              website: companyTable.website,
            })
            .from(companyTable);
          const resolved = resolveCanonicalCompany(companies, {
            companyName: fresh.companyName,
            website: fresh.website,
          });
          if (resolved) {
            if (fresh.companyId && fresh.companyId !== resolved.companyId) {
              throw new DiscoveryCandidateError(
                "COMPANY_LINK_CONFLICT",
                "CANDIDATE_ALREADY_LINKED_TO_OTHER_COMPANY",
              );
            }
            companyId = resolved.companyId;
          } else {
            const [created] = await tx
              .insert(companyTable)
              .values({
                name: fresh.companyName,
                sector: fresh.sector,
                market: fresh.market as CrmMarket,
                website: fresh.website,
                notes: null,
              })
              .returning({ companyId: companyTable.companyId });
            if (!created)
              throw new DiscoveryCandidateError(
                "CONFLICT",
                "COMPANY_CREATE_FAILED",
              );
            companyId = created.companyId;
          }
        }
        if (fresh.reviewState === "accepted" && fresh.companyId === companyId) {
          return loadDbView(tx, fresh.discoveryCandidateId, input, true);
        }
        nextState = "accepted";
        reason = reason || "Accepted for qualification";
        break;
      }
      case "park":
        reason = requireReason(input.reason, input.action);
        nextState = "parked";
        break;
      case "reject":
        reason = requireReason(input.reason, input.action);
        nextState = "rejected";
        break;
      case "request_evidence":
        reason = requireReason(input.reason, input.action);
        nextState = "needs_evidence";
        break;
      case "correct": {
        reason = requireReason(input.reason, input.action);
        nextName = input.companyName?.trim() || fresh.companyName;
        nextWebsite =
          input.website !== undefined
            ? normalizeOptionalWebsite(input.website)
            : fresh.website;
        nextWhy = input.whyNow?.trim() || fresh.whyNow;
        nextService =
          input.relevantService !== undefined
            ? input.relevantService.trim() || null
            : fresh.relevantService;
        nextMissing =
          input.missingFacts !== undefined
            ? input.missingFacts.trim() || null
            : fresh.missingFacts;
        nextRelationship =
          input.knownRelationship !== undefined
            ? input.knownRelationship.trim() || null
            : fresh.knownRelationship;
        const observations = await tx
          .select()
          .from(discoveryObservation)
          .where(
            eq(
              discoveryObservation.discoveryCandidateId,
              input.candidateId,
            ),
          )
          .orderBy(desc(discoveryObservation.createdAt));
        const latest = observations[0];
        nextKey = buildDiscoveryOpportunityKey({
          discoveryChannel: fresh.discoveryChannel,
          opportunityKind: fresh.opportunityKind,
          companyName: nextName,
          website: nextWebsite,
          sourceUrl: latest?.sourceUrl ?? null,
          sourceItemId: fresh.sourceItemId,
          externalOpportunityId: fresh.externalOpportunityId,
          whyNow: nextWhy,
        });
        const [collision] = await tx
          .select()
          .from(discoveryCandidate)
          .where(
            and(
              eq(discoveryCandidate.opportunityKey, nextKey),
              sql`${discoveryCandidate.reviewState} in ('needs_review', 'needs_evidence', 'parked', 'corrected', 'accepted')`,
              sql`${discoveryCandidate.discoveryCandidateId} <> ${input.candidateId}::uuid`,
            ),
          )
          .limit(1);
        if (collision) {
          throw new DiscoveryCandidateError(
            "CONFLICT",
            "OPPORTUNITY_KEY_CONFLICT",
          );
        }
        if (input.excerpt || input.sourceUrl || input.eventDate !== undefined) {
          const sourceUrl = input.sourceUrl
            ? normalizeSourceUrl(input.sourceUrl)
            : latest?.sourceUrl;
          if (!sourceUrl) {
            throw new DiscoveryCandidateError(
              "INVALID_INPUT",
              "EVIDENCE_SOURCE_REQUIRED",
            );
          }
          const excerpt = (input.excerpt ?? latest?.excerpt ?? "").trim();
          if (excerpt.length < 8) {
            throw new DiscoveryCandidateError(
              "INVALID_INPUT",
              "EVIDENCE_EXCERPT_REQUIRED",
            );
          }
          const eventDate =
            input.eventDate === undefined
              ? latest?.publishedOrEventDate ?? null
              : input.eventDate;
          const excerptHash = sha256(excerpt);
          const contentHash = sha256(
            canonicalJson({ sourceUrl, excerpt, eventDate }),
          );
          await tx.insert(discoveryObservation).values({
            discoveryCandidateId: fresh.discoveryCandidateId,
            visibilityScope:
              input.visibilityScope ?? latest?.visibilityScope ?? "public",
            sourceOwnerEmployeeId: input.actorEmployeeId,
            sourceUrl,
            excerpt,
            excerptHash,
            publishedOrEventDate: eventDate,
            verificationState: eventDate ? "dated" : "needs_evidence",
            sourceKey: fresh.sourceKey,
            sourceItemId: fresh.sourceItemId,
            contentHash,
            supersedesObservationId: latest?.discoveryObservationId ?? null,
          });
          const correctedEval = await evaluateDiscoveryEvidence({
            opportunityKind: fresh.opportunityKind,
            excerpt,
            whyNow: nextWhy,
            eventDate,
            visibilityScope:
              input.visibilityScope ??
              (latest?.visibilityScope as DiscoveryVisibility | undefined) ??
              "public",
            companyName: nextName,
            website: nextWebsite,
            sourceUrl,
            evidenceId: latest?.discoveryObservationId,
            sourceKey: fresh.sourceKey,
          });
          nextState = correctedEval.reviewState;
          if (correctedEval.disposition === "awarded") {
            reason = correctedEval.reasons[0] ?? reason;
          }
          if (!nextMissing && correctedEval.reasons.length) {
            nextMissing = correctedEval.reasons.join("; ");
          }
        } else {
          nextState = fresh.reviewState === "accepted" ? "needs_review" : "corrected";
        }
        break;
      }
      default: {
        const unhandled: never = input;
        return unhandled;
      }
    }

    await tx
      .update(discoveryCandidate)
      .set({
        companyName: nextName,
        website: nextWebsite,
        whyNow: nextWhy,
        relevantService: nextService,
        missingFacts: nextMissing,
        knownRelationship: nextRelationship,
        opportunityKey: nextKey,
        reviewState: nextState,
        decisionReason: reason,
        companyId,
        qualificationState: "not_assessed",
        expectedVersion: fresh.expectedVersion + 1,
        decidedByEmployeeId: input.actorEmployeeId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        eq(discoveryCandidate.discoveryCandidateId, fresh.discoveryCandidateId),
      );

    if (nextState === "accepted" && companyId) {
      const [contacts] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(contactTable)
        .where(eq(contactTable.companyId, companyId));
      const [deals] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(dealTable)
        .where(eq(dealTable.companyId, companyId));
      if ((contacts?.count ?? 0) > 0 || (deals?.count ?? 0) > 0) {
        throw new DiscoveryCandidateError(
          "CONFLICT",
          "DISCOVERY_MUST_NOT_CREATE_LATER_STAGE_RECORDS",
        );
      }
    }

    await tx.insert(auditEvent).values({
      actorEmployeeId: input.actorEmployeeId,
      action: `discovery.candidate.${input.action === "request_evidence" ? "request_evidence" : input.action === "link" ? "linked" : input.action === "correct" ? "corrected" : input.action === "accept" ? "accepted" : input.action}`,
      entityType: "discovery_candidate",
      entityId: fresh.discoveryCandidateId,
      before,
      after: {
        reviewState: nextState,
        companyId,
        expectedVersion: fresh.expectedVersion + 1,
        contactCount: 0,
        dealCount: 0,
      },
      reason: reason ?? "Discovery review decision",
    });
    return loadDbView(tx, fresh.discoveryCandidateId, input, true);
  });
}

export async function decideDiscoveryCandidate(
  input: DecideInput & Actor,
) {
  const parsed = discoveryCandidateDecideSchema.parse(input);
  const work = { ...parsed, ...input };
  if (!getDb()) {
    const lockKey =
      parsed.action === "link"
        ? `company:${parsed.companyId}`
        : `candidate:${parsed.candidateId}`;
    return withDecisionLock(lockKey, () => applyMemoryDecision(work));
  }
  return applyPostgresDecision(work);
}
