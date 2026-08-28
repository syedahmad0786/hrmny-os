import { IntegrationMisconfiguredError } from "../types";
import type {
  LeadCandidate,
  LeadEnrichmentIdentity,
  LeadSearchCriteria,
  LeadSourceAdapter,
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
  return {
    externalId: String(
      person.id ?? person.person_id ?? person.email ?? crypto.randomUUID(),
    ),
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

function enrichmentIdentity(
  input: string | LeadEnrichmentIdentity,
): LeadEnrichmentIdentity {
  return typeof input === "string" ? { email: input } : input;
}

/** Deterministic mock — same criteria yield the same candidates (idempotent). */
export function createLeadSourceMock(): LeadSourceAdapter {
  return {
    mode: "mock",
    async searchLeads(criteria: LeadSearchCriteria) {
      const titles = criteria.titles?.length ? criteria.titles : ["CMO"];
      const domain =
        criteria.query?.toLowerCase().replace(/[^a-z0-9]+/g, "") || "democo";
      const perPage = criteria.perPage ?? titles.length;
      return titles.slice(0, perPage).map((title, i) => {
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
    },
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
  return {
    mode: "live",
    async searchLeads(criteria: LeadSearchCriteria) {
      const res = await fetch(
        "https://api.apollo.io/api/v1/mixed_people/api_search",
        {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            q_keywords: criteria.query,
            person_titles: criteria.titles,
            organization_industries: criteria.industries,
            person_locations: criteria.locations,
            organization_num_employees_ranges:
              criteria.employeeCountMin != null ||
              criteria.employeeCountMax != null
                ? [
                    `${criteria.employeeCountMin ?? 1},${criteria.employeeCountMax ?? 100000}`,
                  ]
                : undefined,
            page: criteria.page ?? 1,
            per_page: criteria.perPage ?? 25,
          }),
        },
      );
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "apollo",
          `People search failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        people?: Record<string, unknown>[];
      };
      return (data.people ?? []).map(mapApolloLeadPerson);
    },
    async enrichLead(input: string | LeadEnrichmentIdentity) {
      assertApolloPaidOperationAllowed(config, "People match");
      const identity = enrichmentIdentity(input);
      if (!identity.externalId && !identity.email && !identity.fullName) {
        return null;
      }
      const res = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
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
