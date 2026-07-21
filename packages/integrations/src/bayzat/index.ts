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
  // CSV is the required fallback when client has no API keys
  if (process.env.BAYZAT_API_KEY) return "api";
  return "csv";
}

/** In-memory Bayzat mirror client — CSV import is first-class. */
export function createBayzatAdapter(
  config: BayzatAdapterConfig = {},
): BayzatAdapter {
  const source = resolveSource(config);
  let mirror: BayzatEmployeeRow[] = [...(config.seed ?? [])];

  if (source === "api") {
    const apiKey = config.apiKey ?? process.env.BAYZAT_API_KEY;
    if (!apiKey && !config.seed) {
      throw new IntegrationMisconfiguredError(
        "bayzat",
        "BAYZAT_SOURCE=api but BAYZAT_API_KEY missing — use CSV import or set seed",
      );
    }
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
