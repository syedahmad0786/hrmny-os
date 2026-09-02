import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function vaultSqlTemplates(source: string): string[] {
  return [...source.matchAll(/sql(?:<[^>]*>)?`([\s\S]*?)`/gi)]
    .map((match) => match[1] ?? "")
    .filter((statement) => /vault\.decrypted_secrets/i.test(statement));
}

function vaultLockTargets(statement: string): Array<string | null> {
  const clauses = [
    ...statement.matchAll(
      /\bfor\s+(?:key\s+share|share|no\s+key\s+update|update)\b(?:\s+of\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*))?/gi,
    ),
  ];
  return clauses.flatMap((match) =>
    match[1]
      ? match[1].split(",").map((target) => target.trim().toLowerCase())
      : [null],
  );
}

describe("Apollo queued-worker import boundary", () => {
  it("does not export the unfenced receipt runner to production callers", () => {
    const source = readFileSync(
      new URL("./apollo-search.ts", import.meta.url),
      {
        encoding: "utf8",
      },
    );
    expect(source).not.toMatch(
      /export async function runScheduledApolloPeopleSearch\s*\(/,
    );
    expect(source).toMatch(
      /async function runScheduledApolloPeopleSearch\s*\(/,
    );
    expect(source).toMatch(/process\.env\.NODE_ENV !== "test"/);
    expect(source).toMatch(/executeAuthorizedProviderDispatch/);
  });

  it("never requests a row lock through the permitted Vault view", () => {
    const searchSource = readFileSync(
      new URL("./apollo-search.ts", import.meta.url),
      "utf8",
    );
    const keySource = readFileSync(
      new URL("../integrations/resolve-keys.ts", import.meta.url),
      "utf8",
    );
    const governedSource = readFileSync(
      new URL("../integrations/governed-api-key.ts", import.meta.url),
      "utf8",
    );

    const statements = [
      ...vaultSqlTemplates(searchSource),
      ...vaultSqlTemplates(keySource),
      ...vaultSqlTemplates(governedSource),
    ];
    expect(statements.length).toBeGreaterThan(1);
    const lockTargets = statements.flatMap(vaultLockTargets);
    expect(lockTargets).toEqual(["connection"]);
  });

  it("routes production key persistence through the governed provider lane", () => {
    const connectionsSource = readFileSync(
      new URL("../trpc/connections-router.ts", import.meta.url),
      "utf8",
    );
    const governedSource = readFileSync(
      new URL("../integrations/governed-api-key.ts", import.meta.url),
      "utf8",
    );

    expect(connectionsSource).toMatch(
      /row = await persistGovernedApiKeyConnection\(\{/,
    );
    expect(connectionsSource).toMatch(/disconnectGovernedApiKeyConnection\(\{/);
    expect(governedSource).toMatch(
      /input\.toolkit === "apollo"[\s\S]*pg_try_advisory_xact_lock/,
    );
    expect(governedSource).toMatch(
      /input\.expectedToolkit === "apollo"[\s\S]*pg_try_advisory_xact_lock/,
    );
    expect(governedSource.match(/set local lock_timeout/g)).toHaveLength(2);
    expect(
      governedSource.match(/set local idle_in_transaction_session_timeout/g),
    ).toHaveLength(2);
    expect(
      governedSource.match(
        /from public\.scheduled_job job[\s\S]*?providerDispatchState[\s\S]*?authorized[\s\S]*?ambiguous/g,
      ),
    ).toHaveLength(1);
    expect(
      governedSource.match(/unsettledApolloProviderDispatchQuery/g),
    ).toHaveLength(3);
    expect(governedSource).toMatch(/providerMaySettle' = 'true'/);
    expect(governedSource).toMatch(/vault\.update_secret[\s\S]*hrmny:revoked/);
    expect(governedSource).not.toMatch(/delete\s+from\s+vault\./i);
    expect(governedSource).toMatch(
      /deleted\.length !== 1[\s\S]*Connection account was not deleted/,
    );

    const searchSource = readFileSync(
      new URL("./apollo-search.ts", import.meta.url),
      "utf8",
    );
    expect(searchSource).toMatch(
      /recordProviderDispatchSettlement[\s\S]*providerDispatchState/,
    );
    expect(searchSource).toMatch(
      /date_trunc\('milliseconds', statement_timestamp\(\)\) as claimed_at/,
    );
    expect(searchSource).toMatch(
      /workerClaimedAt[\s\S]*workerLeaseExpiresAt[\s\S]*executeAuthorizedProviderDispatch/,
    );
    expect(searchSource).toMatch(
      /providerOutcomeAmbiguous'\)::boolean[\s\S]*or \$\{providerOutcomeAmbiguous\}::boolean/,
    );
  });
});
