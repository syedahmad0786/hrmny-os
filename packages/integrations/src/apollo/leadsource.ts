import { IntegrationMisconfiguredError } from "../types";
import type {
  LeadCandidate,
  LeadSearchCriteria,
  LeadSourceAdapter,
} from "../contracts";

/**
 * M8 lead sourcing against the frozen `LeadSourceAdapter` contract (Apollo-shaped).
 * Mock by default; live REST fails loud without a key — same shape as
 * `./index.ts` ApolloAdapter. `searchLeads` → POST /v1/mixed_people/search,
 * `enrichLead` → POST /v1/people/match. Never writes the CRM (dedupe does that).
 */

export type LeadSourceConfig = {
  mode?: "mock" | "live";
  apiKey?: string;
};

function resolveMode(config: LeadSourceConfig): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const env = process.env.APOLLO_MODE?.toLowerCase();
  if (env === "live") return "live";
  if (env === "mock") return "mock";
  if ((config.apiKey ?? process.env.APOLLO_API_KEY)?.trim()) return "live";
  return "mock";
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
function mapPerson(person: Record<string, unknown>): LeadCandidate {
  const org = (person.organization ?? {}) as Record<string, unknown>;
  return {
    externalId: String(person.id ?? person.email ?? crypto.randomUUID()),
    fullName: (person.name as string) ?? undefined,
    title: (person.title as string) ?? undefined,
    email: (person.email as string) ?? undefined,
    emailStatus: (person.email_status as string) ?? undefined,
    companyName: (org.name as string) ?? undefined,
    companyDomain: (org.primary_domain as string) ?? undefined,
    linkedinUrl: (person.linkedin_url as string) ?? undefined,
    source: "apollo",
    raw: person,
  };
}

/** Deterministic mock — same criteria yield the same candidates (idempotent). */
export function createLeadSourceMock(): LeadSourceAdapter {
  return {
    mode: "mock",
    async searchLeads(criteria: LeadSearchCriteria) {
      const titles = criteria.titles?.length ? criteria.titles : ["CMO"];
      const domain =
        criteria.query?.toLowerCase().replace(/[^a-z0-9]+/g, "") ||
        "democo";
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
    async enrichLead(email: string) {
      if (!email.includes("@")) return null;
      const domain = email.split("@")[1] ?? "unknown.local";
      return {
        externalId: stableId(email),
        fullName: "Alex Prospect",
        title: "CMO",
        email,
        emailStatus: "unverified",
        companyName: domain.split(".")[0],
        companyDomain: domain,
        source: "apollo_mock",
        raw: { email },
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
      const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
        method: "POST",
        headers,
        body: JSON.stringify({
          q_keywords: criteria.query,
          person_titles: criteria.titles,
          organization_industries: criteria.industries,
          person_locations: criteria.locations,
          organization_num_employees_ranges:
            criteria.employeeCountMin != null || criteria.employeeCountMax != null
              ? [`${criteria.employeeCountMin ?? 1},${criteria.employeeCountMax ?? 100000}`]
              : undefined,
          page: criteria.page ?? 1,
          per_page: criteria.perPage ?? 25,
        }),
      });
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "apollo",
          `People search failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        people?: Record<string, unknown>[];
      };
      return (data.people ?? []).map(mapPerson);
    },
    async enrichLead(email: string) {
      const res = await fetch("https://api.apollo.io/v1/people/match", {
        method: "POST",
        headers,
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "apollo",
          `People match failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as { person?: Record<string, unknown> };
      return data.person ? mapPerson(data.person) : null;
    },
  };
}

export function createLeadSourceAdapter(
  config: LeadSourceConfig = {},
): LeadSourceAdapter {
  return resolveMode(config) === "live"
    ? createLeadSourceLive(config)
    : createLeadSourceMock();
}
