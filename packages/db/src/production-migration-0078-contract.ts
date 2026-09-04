import {
  HRMNY_PRODUCTION_0077_MIGRATION,
  type Production0075To0077JournalRow,
} from "./production-migration-0075-0077-contract";
import {
  validateProduction0075Target,
  type ValidatedProduction0075Target,
} from "./production-migration-0075-contract";

export const HRMNY_PRODUCTION_0078_CONFIRMATION =
  "APPLY MIGRATION 0078 GCC MARKETS TO HRMNY PRODUCTION";

export const HRMNY_PRODUCTION_0078_MIGRATION = {
  createdAt: "1788498000000",
  hash: "48087f28287fe2dada8cabd2f81c180407c77d7b923ed8655d4c441945cb6048",
  tag: "0078_gcc_markets" as const,
};

export const HRMNY_MARKETS_0077 = ["UAE", "KSA", "Both"] as const;
export const HRMNY_MARKETS_0078 = [
  ...HRMNY_MARKETS_0077,
  "Oman",
  "Qatar",
  "Kuwait",
  "Bahrain",
  "GCC",
] as const;

export type Production0078Phase = "audit" | "preflight" | "verify";

export function validateProduction0078Inputs(input: {
  phase: Production0078Phase;
  databaseUrl: string | undefined;
  projectRef: string | undefined;
  confirmation: string | undefined;
}): ValidatedProduction0075Target {
  const target = validateProduction0075Target(input);
  if (
    input.phase === "preflight" &&
    input.confirmation !== HRMNY_PRODUCTION_0078_CONFIRMATION
  ) {
    throw new Error("Exact 0078 production confirmation phrase is missing.");
  }
  return target;
}

function sameValues<T>(actual: readonly T[], expected: readonly T[]) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameRows(
  actual: Production0075To0077JournalRow[],
  expected: Production0075To0077JournalRow[],
) {
  return (
    actual.length === expected.length &&
    actual.every(
      (row, index) =>
        row.created_at === expected[index]?.created_at &&
        row.hash === expected[index]?.hash,
    )
  );
}

export function validateProduction0078State(input: {
  phase: Production0078Phase;
  migrationRows: Production0075To0077JournalRow[];
  marketValues: string[];
}): { migrationsToApply: 0 | 1; state: "0077" | "0078" } {
  const priorRows = [
    {
      created_at: HRMNY_PRODUCTION_0077_MIGRATION.createdAt,
      hash: HRMNY_PRODUCTION_0077_MIGRATION.hash,
    },
  ];
  const completeRows = [
    ...priorRows,
    {
      created_at: HRMNY_PRODUCTION_0078_MIGRATION.createdAt,
      hash: HRMNY_PRODUCTION_0078_MIGRATION.hash,
    },
  ];
  const at0077 =
    sameRows(input.migrationRows, priorRows) &&
    sameValues(input.marketValues, HRMNY_MARKETS_0077);
  const at0078 =
    sameRows(input.migrationRows, completeRows) &&
    sameValues(input.marketValues, HRMNY_MARKETS_0078);

  if (!at0077 && !at0078) {
    throw new Error(
      "Production is not an exact 0077 or 0078 market/journal state.",
    );
  }
  if (input.phase === "verify" && !at0078) {
    throw new Error("Production did not append the exact reviewed 0078 row.");
  }
  return at0078
    ? { migrationsToApply: 0, state: "0078" }
    : { migrationsToApply: 1, state: "0077" };
}
