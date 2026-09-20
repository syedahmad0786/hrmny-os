import {
  normalizeResearchCompanyName,
  normalizeResearchWebsiteHost,
} from "./research-evidence";

export const DISCOVERY_FRESHNESS_DAYS = {
  news: 30,
  hiring: 14,
  leadership: 90,
} as const;

export const DISCOVERY_EVIDENCE_ROUTES = [
  "manual",
  "import",
  "automated",
] as const;

export const DISCOVERY_DISPOSITIONS = [
  "actionable",
  "undated",
  "stale",
  "awarded",
  "duplicate",
  "unsupported",
  "needs_evidence",
] as const;

export type DiscoveryEvidenceRoute = (typeof DISCOVERY_EVIDENCE_ROUTES)[number];
export type DiscoveryDisposition = (typeof DISCOVERY_DISPOSITIONS)[number];

const AWARDED_PATTERN =
  /\b(awarded|appointed|appointment|agency of record|won the account|won the pitch|already[- ]awarded)\b/i;
const UNSUPPORTED_CERTAINTY_PATTERN =
  /\b(confirmed (?:aed|budget|intent|authority)|will buy|buyer has approved|aed\s*\d)/i;

export function parseDiscoveryEventDate(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = Date.parse(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  return raw;
}

export function discoveryAgeDays(
  eventDate: string | null | undefined,
  now = new Date(),
): number | null {
  const normalized = parseDiscoveryEventDate(eventDate);
  if (!normalized) return null;
  const event = Date.parse(`${normalized}T00:00:00.000Z`);
  return Math.floor((now.getTime() - event) / 86_400_000);
}

export function isAwardedAppointment(text: string | null | undefined) {
  return AWARDED_PATTERN.test(text ?? "");
}

export function hasUnsupportedCertainty(text: string | null | undefined) {
  return UNSUPPORTED_CERTAINTY_PATTERN.test(text ?? "");
}

export function isClaimGroundedInExcerpt(
  claim: string,
  excerpt: string | null | undefined,
) {
  const haystack = (excerpt ?? "").toLowerCase();
  if (!haystack.trim() || !claim.trim()) return false;
  const tokens = claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  if (tokens.length === 0) return haystack.includes(claim.trim().toLowerCase());
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched / tokens.length >= 0.5;
}

export function discoveryIdentityKey(input: {
  companyName: string;
  website?: string | null;
  sourceUrl?: string | null;
}) {
  return {
    companyName: normalizeResearchCompanyName(input.companyName),
    host:
      normalizeResearchWebsiteHost(input.website) ??
      normalizeResearchWebsiteHost(input.sourceUrl),
  };
}

export function freshnessWindowDays(opportunityKind: string) {
  if (opportunityKind === "hiring") return DISCOVERY_FRESHNESS_DAYS.hiring;
  if (opportunityKind === "leadership")
    return DISCOVERY_FRESHNESS_DAYS.leadership;
  if (opportunityKind === "tender") return null;
  return DISCOVERY_FRESHNESS_DAYS.news;
}

export function classifyDiscoveryDisposition(input: {
  opportunityKind: string;
  excerpt: string;
  whyNow: string;
  eventDate?: string | null;
  now?: Date;
}): {
  disposition: DiscoveryDisposition;
  reviewState:
    | "needs_review"
    | "needs_evidence"
    | "parked";
  reasons: string[];
} {
  const reasons: string[] = [];
  const eventDate = parseDiscoveryEventDate(input.eventDate);
  if (isAwardedAppointment(`${input.excerpt} ${input.whyNow}`)) {
    reasons.push(
      "Already-awarded appointment is intelligence, not an open pitch",
    );
    return { disposition: "awarded", reviewState: "parked", reasons };
  }
  if (!eventDate) {
    reasons.push("Source date is missing; ingestion time is not a substitute");
    return { disposition: "undated", reviewState: "needs_evidence", reasons };
  }
  const age = discoveryAgeDays(eventDate, input.now);
  const window = freshnessWindowDays(input.opportunityKind);
  if (age !== null && age < 0) {
    reasons.push("Event date is in the future and is not treated as verified");
    return {
      disposition: "needs_evidence",
      reviewState: "needs_evidence",
      reasons,
    };
  }
  if (window !== null && age !== null && age > window) {
    reasons.push(
      `Event date is ${age} days old and outside the ${window}-day ${input.opportunityKind} window`,
    );
    return { disposition: "stale", reviewState: "needs_evidence", reasons };
  }
  if (
    hasUnsupportedCertainty(input.whyNow) &&
    !isClaimGroundedInExcerpt(input.whyNow, input.excerpt)
  ) {
    reasons.push(
      "Buyer budget, authority or intent is not supported by the stored excerpt",
    );
    return {
      disposition: "unsupported",
      reviewState: "needs_evidence",
      reasons,
    };
  }
  return {
    disposition: "actionable",
    reviewState: "needs_review",
    reasons,
  };
}

export function classifyDiscoveryReviewState(input: {
  opportunityKind: string;
  eventDate?: string | null;
  excerpt?: string;
  whyNow?: string;
  now?: Date;
}) {
  return classifyDiscoveryDisposition({
    opportunityKind: input.opportunityKind,
    excerpt: input.excerpt ?? "",
    whyNow: input.whyNow ?? "",
    eventDate: input.eventDate,
    now: input.now,
  }).reviewState;
}
