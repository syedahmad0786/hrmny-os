import { createHash } from "node:crypto";
import { IntegrationMisconfiguredError } from "../types";
import type {
  LeadCandidate,
  LeadEnrichmentIdentity,
  LeadSearchExecution,
  LeadSearchCriteria,
  LeadSourceAdapter,
  ProviderRateLimitSnapshot,
} from "../contracts";
import {
  assertApolloPaidOperationAllowed,
  resolveApolloMode,
  type ApolloActivationConfig,
} from "./policy";

/**
 * M8 lead sourcing against the frozen `LeadSourceAdapter` contract (Apollo-shaped).
 * Mock by default; live REST fails loud without a key — same shape as
 * `./index.ts` ApolloAdapter. `searchLeads` → POST
 * /api/v1/mixed_people/api_search, `enrichLead` → POST
 * /api/v1/people/match. Never writes the CRM (dedupe does that).
 */

export type LeadSourceConfig = ApolloActivationConfig;

export type ApolloCreditUsage = {
  credits: Record<
    string,
    { limit: number; consumed: number; leftOver: number }
  >;
  cycle: { startDate: string | null; endDate: string | null };
  receivedAt: string;
};

export class ApolloProviderRequestError extends IntegrationMisconfiguredError {
  readonly providerCode = "APOLLO_PROVIDER_REQUEST_FAILED" as const;

  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
    readonly providerReceipt?: LeadSearchExecution["providerReceipt"],
  ) {
    super("apollo", message);
    this.name = "ApolloProviderRequestError";
  }
}

function positiveHeaderInteger(
  headers: Headers,
  name: string,
): number | undefined {
  const value = headers.get(name)?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function apolloRateLimitSnapshot(
  headers: Headers,
): ProviderRateLimitSnapshot {
  return {
    minuteLimit: positiveHeaderInteger(headers, "x-rate-limit-minute"),
    hourlyLimit: positiveHeaderInteger(headers, "x-rate-limit-hourly"),
    dailyLimit: positiveHeaderInteger(headers, "x-rate-limit-24-hour"),
    minuteUsed: positiveHeaderInteger(headers, "x-minute-usage"),
    hourlyUsed: positiveHeaderInteger(headers, "x-hourly-usage"),
    dailyUsed: positiveHeaderInteger(headers, "x-24-hour-usage"),
    minuteRemaining: positiveHeaderInteger(headers, "x-minute-requests-left"),
    hourlyRemaining: positiveHeaderInteger(headers, "x-hourly-requests-left"),
    dailyRemaining: positiveHeaderInteger(headers, "x-24-hour-requests-left"),
    retryAfterSeconds: positiveHeaderInteger(headers, "retry-after"),
  };
}

export function isRetryableApolloProviderError(error: unknown): boolean {
  return error instanceof ApolloProviderRequestError && error.retryable;
}

/** Fetch-only failures are normalized before they leave the adapter. */
function isApolloFetchTransportError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }
  return error instanceof TypeError;
}

function responseHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

/** Zero-credit Apollo team balance read from the documented usage endpoint. */
export async function getApolloCreditUsage(
  apiKeyInput: string,
): Promise<ApolloCreditUsage> {
  const apiKey = apiKeyInput.trim();
  if (!apiKey) {
    throw new IntegrationMisconfiguredError("apollo", "Apollo API key missing");
  }

  let response: Response;
  try {
    response = await fetch(
      "https://api.apollo.io/api/v1/usage_stats/credit_usage_stats",
      {
        method: "POST",
        redirect: "error",
        headers: { accept: "application/json", "X-Api-Key": apiKey },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch (error) {
    if (isApolloFetchTransportError(error)) {
      throw new ApolloProviderRequestError(
        "Credit balance transport failed",
        null,
        true,
      );
    }
    throw error;
  }

  const rawBody = await response.text();
  const providerReceipt = {
    provider: "apollo",
    operation: "credits.usage",
    httpStatus: response.status,
    responseHash: responseHash(rawBody),
    receivedAt: new Date().toISOString(),
    rateLimit: apolloRateLimitSnapshot(response.headers),
  } satisfies LeadSearchExecution["providerReceipt"];
  if (!response.ok) {
    throw new ApolloProviderRequestError(
      `Credit balance failed: HTTP ${response.status}`,
      response.status,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      providerReceipt.rateLimit.retryAfterSeconds,
      providerReceipt,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    throw new ApolloProviderRequestError(
      "Credit balance returned invalid JSON",
      response.status,
      false,
      undefined,
      providerReceipt,
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApolloProviderRequestError(
      "Credit balance returned an invalid object",
      response.status,
      false,
      undefined,
      providerReceipt,
    );
  }

  const data = body as Record<string, unknown>;
  const rawCredits = data.credit_usage_stats;
  const rawCycle = data.current_credit_cycle;
  if (
    !rawCredits ||
    typeof rawCredits !== "object" ||
    Array.isArray(rawCredits)
  ) {
    throw new ApolloProviderRequestError(
      "Credit balance omitted credit usage stats",
      response.status,
      false,
      undefined,
      providerReceipt,
    );
  }

  const credits: ApolloCreditUsage["credits"] = {};
  for (const [kind, raw] of Object.entries(rawCredits)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const bucket = raw as Record<string, unknown>;
    const limit = safeInteger(bucket.limit);
    const consumed = safeInteger(bucket.consumed);
    const leftOver = safeInteger(bucket.left_over);
    if (limit === null || consumed === null || leftOver === null) continue;
    credits[kind] = { limit, consumed, leftOver };
  }
  if (!Object.keys(credits).length) {
    throw new ApolloProviderRequestError(
      "Credit balance contained no valid credit types",
      response.status,
      false,
      undefined,
      providerReceipt,
    );
  }
  const cycle =
    rawCycle && typeof rawCycle === "object" && !Array.isArray(rawCycle)
      ? (rawCycle as Record<string, unknown>)
      : {};
  return {
    credits,
    cycle: {
      startDate: typeof cycle.start_date === "string" ? cycle.start_date : null,
      endDate: typeof cycle.end_date === "string" ? cycle.end_date : null,
    },
    receivedAt: providerReceipt.receivedAt,
  };
}

/** Stable id from a string so re-running the same search dedupes cleanly. */
function stableId(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return `apollo_mock_${(h >>> 0).toString(16)}`;
}

/** Map an Apollo `person` record to the frozen LeadCandidate shape. */
function usableEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim();
  if (!email.includes("@")) return undefined;
  const compact = email.toLowerCase().replace(/[\s\u00a0]+/g, "");
  if (
    compact.includes("[emailprotected]") ||
    compact.includes("email_not_unlocked")
  ) {
    return undefined;
  }
  return email;
}

function usableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  return usableText(value)?.slice(0, maxLength);
}

/**
 * People Search intentionally returns a first name plus an obfuscated last
 * name, while People Match returns `name`. Preserve that provider boundary and
 * never invent a fuller identity than Apollo supplied.
 */
function apolloDisplayName(person: Record<string, unknown>) {
  const completeName = usableText(person.name);
  if (completeName) return completeName;

  const firstName = usableText(person.first_name);
  const lastName =
    usableText(person.last_name) ?? usableText(person.last_name_obfuscated);
  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  return displayName || undefined;
}

/** Map an Apollo `person` record to the frozen LeadCandidate shape. */
export function mapApolloLeadPerson(
  person: Record<string, unknown>,
): LeadCandidate {
  const org = (person.organization ?? {}) as Record<string, unknown>;
  const providerIdentity =
    person.id ?? person.person_id ?? usableEmail(person.email);
  const externalId = providerIdentity
    ? String(providerIdentity)
    : `apollo_response_${responseHash(JSON.stringify(person)).slice(0, 32)}`;
  return {
    externalId,
    fullName: apolloDisplayName(person),
    title: (person.title as string) ?? undefined,
    email: usableEmail(person.email),
    emailStatus: (person.email_status as string) ?? undefined,
    companyName: (org.name as string) ?? undefined,
    companyDomain: (org.primary_domain as string) ?? undefined,
    linkedinUrl: (person.linkedin_url as string) ?? undefined,
    source: "apollo",
    raw: person,
  };
}

/**
 * People Search is a zero-credit discovery surface, not enrichment. Keep an
 * explicit allowlist so a provider response expansion cannot silently persist
 * email, phone, a complete last name, profile URLs, or arbitrary raw fields.
 */
export function mapApolloSearchPerson(
  person: Record<string, unknown>,
): LeadCandidate {
  const organization =
    person.organization &&
    typeof person.organization === "object" &&
    !Array.isArray(person.organization)
      ? (person.organization as Record<string, unknown>)
      : {};
  const firstName = boundedText(person.first_name, 120);
  const obscuredLastName = boundedText(person.last_name_obfuscated, 120);
  const fullName = [firstName, obscuredLastName].filter(Boolean).join(" ");
  const externalId =
    boundedText(person.id ?? person.person_id, 180) ??
    `apollo_search_${responseHash(
      JSON.stringify({
        firstName,
        obscuredLastName,
        title: boundedText(person.title, 180),
        companyName: boundedText(organization.name, 180),
        companyDomain: boundedText(organization.primary_domain, 255),
      }),
    ).slice(0, 32)}`;

  return {
    externalId,
    fullName: fullName || undefined,
    title: boundedText(person.title, 180),
    companyName: boundedText(organization.name, 180),
    companyDomain: boundedText(organization.primary_domain, 255),
    source: "apollo",
    raw: {},
  };
}

function enrichmentIdentity(
  input: string | LeadEnrichmentIdentity,
): LeadEnrichmentIdentity {
  return typeof input === "string" ? { email: input } : input;
}

/** Deterministic mock — same criteria yield the same candidates (idempotent). */
export function createLeadSourceMock(): LeadSourceAdapter {
  async function executeSearch(
    criteria: LeadSearchCriteria,
  ): Promise<LeadSearchExecution> {
    const titles = criteria.titles?.length ? criteria.titles : ["CMO"];
    const domain =
      criteria.query?.toLowerCase().replace(/[^a-z0-9]+/g, "") || "democo";
    const perPage = criteria.perPage ?? titles.length;
    const candidates = titles.slice(0, perPage).map((title, i) => {
      const email = `lead${i}@${domain}.example`;
      return {
        externalId: stableId(email),
        fullName: `Lead ${i} ${title}`,
        title,
        email,
        emailStatus: "unverified",
        companyName: `${domain} LLC`,
        companyDomain: `${domain}.example`,
        linkedinUrl: `https://linkedin.example/in/lead${i}`,
        source: "apollo_mock",
        raw: { criteria, title },
      } satisfies LeadCandidate;
    });
    const rawBody = JSON.stringify({ people: candidates });
    return {
      candidates,
      providerReceipt: {
        provider: "apollo_mock",
        operation: "people.search.synthetic",
        httpStatus: 200,
        responseHash: responseHash(rawBody),
        receivedAt: new Date().toISOString(),
        rateLimit: {},
      },
    };
  }

  return {
    mode: "mock",
    async searchLeads(criteria: LeadSearchCriteria) {
      return (await executeSearch(criteria)).candidates;
    },
    searchLeadsWithReceipt: executeSearch,
    async enrichLead(input: string | LeadEnrichmentIdentity) {
      const identity = enrichmentIdentity(input);
      const email = identity.email;
      if (!email?.includes("@") && !identity.externalId) return null;
      const domain =
        identity.companyDomain ?? email?.split("@")[1] ?? "unknown.local";
      const stableSeed =
        identity.externalId ?? email ?? identity.fullName ?? domain;
      return {
        externalId: identity.externalId ?? stableId(stableSeed),
        fullName: identity.fullName ?? "Alex Prospect",
        title: "CMO",
        email,
        emailStatus: "unverified",
        companyName: identity.companyName ?? domain.split(".")[0],
        companyDomain: identity.companyDomain ?? domain,
        linkedinUrl: identity.linkedinUrl,
        source: "apollo_mock",
        raw: { ...identity, email },
      } satisfies LeadCandidate;
    },
  };
}

/** Live Apollo REST — fail-loud without API key. */
export function createLeadSourceLive(
  config: LeadSourceConfig = {},
): LeadSourceAdapter {
  const apiKey = config.apiKey ?? process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new IntegrationMisconfiguredError(
      "apollo",
      "APOLLO_MODE=live but APOLLO_API_KEY missing — fail loud",
    );
  }
  const headers = {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
  };

  async function executePeopleSearch(
    criteria: LeadSearchCriteria,
  ): Promise<LeadSearchExecution> {
    if (criteria.industries?.length) {
      throw new IntegrationMisconfiguredError(
        "apollo",
        "Apollo People Search does not document a direct industry parameter; use documented titles, locations, or q_keywords in this adapter",
      );
    }
    const perPage = criteria.perPage ?? 25;
    if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new IntegrationMisconfiguredError(
        "apollo",
        "Apollo People Search perPage must be an integer between 1 and 100",
      );
    }
    let res: Response;
    try {
      res = await fetch(
        "https://api.apollo.io/api/v1/mixed_people/api_search",
        {
          method: "POST",
          redirect: "error",
          headers,
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            q_keywords: criteria.query,
            person_titles: criteria.titles,
            include_similar_titles: criteria.titles?.length
              ? (criteria.includeSimilarTitles ?? true)
              : undefined,
            person_locations: criteria.locations,
            person_seniorities: criteria.seniorities,
            organization_locations: criteria.organizationLocations,
            contact_email_status: criteria.emailStatuses,
            currently_using_any_of_technology_uids: criteria.technologyIds,
            organization_num_employees_ranges:
              criteria.employeeCountMin != null ||
              criteria.employeeCountMax != null
                ? [
                    `${criteria.employeeCountMin ?? 1},${criteria.employeeCountMax ?? 100000}`,
                  ]
                : undefined,
            page: criteria.page ?? 1,
            per_page: perPage,
          }),
        },
      );
    } catch (error) {
      if (isApolloFetchTransportError(error)) {
        throw new ApolloProviderRequestError(
          "People search transport failed",
          null,
          true,
        );
      }
      throw error;
    }
    const rawBody = await res.text();
    const rateLimit = apolloRateLimitSnapshot(res.headers);
    const providerReceipt = {
      provider: "apollo",
      operation: "people.search",
      httpStatus: res.status,
      responseHash: responseHash(rawBody),
      receivedAt: new Date().toISOString(),
      rateLimit,
    } satisfies LeadSearchExecution["providerReceipt"];
    if (!res.ok) {
      const retryable =
        res.status === 408 ||
        res.status === 425 ||
        res.status === 429 ||
        res.status >= 500;
      throw new ApolloProviderRequestError(
        `People search failed: HTTP ${res.status}`,
        res.status,
        retryable,
        rateLimit.retryAfterSeconds,
        providerReceipt,
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(rawBody) as unknown;
    } catch {
      throw new ApolloProviderRequestError(
        "People search returned invalid JSON",
        res.status,
        false,
        undefined,
        providerReceipt,
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ApolloProviderRequestError(
        "People search returned an invalid object",
        res.status,
        false,
        undefined,
        providerReceipt,
      );
    }
    const people = (data as { people?: unknown }).people;
    if (!Array.isArray(people)) {
      throw new ApolloProviderRequestError(
        "People search returned an invalid people collection",
        res.status,
        false,
        undefined,
        providerReceipt,
      );
    }
    if (
      people.some(
        (person) =>
          !person || typeof person !== "object" || Array.isArray(person),
      )
    ) {
      throw new ApolloProviderRequestError(
        "People search returned an invalid person record",
        res.status,
        false,
        undefined,
        providerReceipt,
      );
    }
    const candidates = people
      .slice(0, perPage)
      .map((person) =>
        mapApolloSearchPerson(person as Record<string, unknown>),
      );
    return {
      candidates,
      providerReceipt,
    };
  }

  return {
    mode: "live",
    async searchLeads(criteria: LeadSearchCriteria) {
      return (await executePeopleSearch(criteria)).candidates;
    },
    searchLeadsWithReceipt: executePeopleSearch,
    async enrichLead(input: string | LeadEnrichmentIdentity) {
      assertApolloPaidOperationAllowed(config, "People match");
      const identity = enrichmentIdentity(input);
      if (!identity.externalId && !identity.email && !identity.fullName) {
        return null;
      }
      const res = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        redirect: "error",
        headers,
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          id: identity.externalId,
          email: identity.email,
          name: identity.fullName,
          organization_name: identity.companyName,
          domain: identity.companyDomain,
          linkedin_url: identity.linkedinUrl,
          reveal_personal_emails: false,
          reveal_phone_number: false,
          run_waterfall_email: false,
          run_waterfall_phone: false,
        }),
      });
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "apollo",
          `People match failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as { person?: Record<string, unknown> };
      return data.person ? mapApolloLeadPerson(data.person) : null;
    },
  };
}

export function createLeadSourceAdapter(
  config: LeadSourceConfig = {},
): LeadSourceAdapter {
  return resolveApolloMode(config) === "live"
    ? createLeadSourceLive(config)
    : createLeadSourceMock();
}
