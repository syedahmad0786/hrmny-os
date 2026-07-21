import {
  IntegrationMisconfiguredError,
  type ApolloAdapter,
} from "../types";

export type ApolloAdapterConfig = {
  mode?: "mock" | "live";
  apiKey?: string;
};

function resolveMode(config: ApolloAdapterConfig): "mock" | "live" {
  if (config.mode === "mock") return "mock";
  if (config.mode === "live") return "live";
  const env = process.env.APOLLO_MODE?.toLowerCase();
  if (env === "live") return "live";
  return "mock";
}

/** Mock Apollo — deterministic enrich for demo emails. */
export function createApolloMock(): ApolloAdapter {
  return {
    async enrichPerson(email: string) {
      const domain = email.split("@")[1] ?? "unknown.local";
      return {
        email,
        firstName: "Alex",
        lastName: "Prospect",
        title: "CMO",
        organization: domain.split(".")[0],
        emailStatus: "verified",
        source: "apollo_mock",
      };
    },
    async searchCompanies(query: string) {
      return [
        {
          name: query || "Demo Co LLC",
          domain: "democo.example",
          industry: "Retail",
          source: "apollo_mock",
        },
      ];
    },
  };
}

/** Live Apollo REST — fail-loud without API key. */
export function createApolloLive(config: ApolloAdapterConfig = {}): ApolloAdapter {
  const apiKey = config.apiKey ?? process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new IntegrationMisconfiguredError(
      "apollo",
      "APOLLO_MODE=live but APOLLO_API_KEY missing — fail loud",
    );
  }
  return {
    async enrichPerson(email: string) {
      const res = await fetch("https://api.apollo.io/v1/people/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "apollo",
          `People match failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as { person?: Record<string, unknown> };
      return data.person ?? null;
    },
    async searchCompanies(query: string) {
      const res = await fetch("https://api.apollo.io/v1/mixed_companies/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify({ q_organization_name: query, page: 1 }),
      });
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "apollo",
          `Company search failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        organizations?: Record<string, unknown>[];
      };
      return data.organizations ?? [];
    },
  };
}

export function createApolloStub(): ApolloAdapter {
  return createApolloMock();
}

export function createApolloAdapter(
  config: ApolloAdapterConfig = {},
): ApolloAdapter {
  return resolveMode(config) === "live"
    ? createApolloLive(config)
    : createApolloMock();
}
