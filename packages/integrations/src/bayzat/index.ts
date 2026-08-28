import {
  IntegrationMisconfiguredError,
  type BayzatAdapter,
  type BayzatEmployeeRow,
  type BayzatSource,
} from "../types";
import { parseBayzatCsv } from "./csv";

export { parseBayzatCsv } from "./csv";

export type BayzatAdapterConfig = {
  source?: BayzatSource;
  apiKey?: string;
  apiBaseUrl?: string;
  /** Seed rows for mock/api-without-network demos. */
  seed?: BayzatEmployeeRow[];
};

function resolveSource(config: BayzatAdapterConfig): BayzatSource {
  if (config.source) return config.source;
  const env = process.env.BAYZAT_SOURCE?.toLowerCase();
  if (env === "api") return "api";
  if (env === "csv") return "csv";
  // No public, evidence-backed employee API contract has been verified.
  return "csv";
}

/** In-memory Bayzat mirror client — CSV import is first-class. */
export function createBayzatAdapter(
  config: BayzatAdapterConfig = {},
): BayzatAdapter {
  const source = resolveSource(config);
  let mirror: BayzatEmployeeRow[] = [...(config.seed ?? [])];

  if (source === "api") {
    throw new IntegrationMisconfiguredError(
      "bayzat",
      "BAYZAT_SOURCE=api is not implemented: no official employee-list API contract is publicly verifiable. Use the bounded CSV mirror until Bayzat supplies tenant documentation.",
    );
  }

  return {
    source,
    async listEmployees() {
      return [...mirror];
    },
    async importCsv(csvText: string) {
      const rows = parseBayzatCsv(csvText);
      const byId = new Map(mirror.map((r) => [r.externalId, r]));
      for (const row of rows) byId.set(row.externalId, row);
      mirror = [...byId.values()];
      return rows;
    },
  };
}

/** @deprecated Prefer createBayzatAdapter */
export function createBayzatStub(
  source: BayzatSource = "csv",
): BayzatAdapter {
  return createBayzatAdapter({ source, seed: [] });
}
