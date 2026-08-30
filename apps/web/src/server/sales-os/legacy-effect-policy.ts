export const LEGACY_SALES_EFFECT_SKIPPED =
  "legacy_sales_effect_disabled" as const;

export const LEGACY_SALES_EFFECT_REASON =
  "Use the reviewed Signal → Research → Person → Outreach flow; legacy bulk/demo Sales effects are synthetic-only.";

export class LegacySalesEffectDisabledError extends Error {
  readonly code = LEGACY_SALES_EFFECT_SKIPPED;
  readonly operation: string;

  constructor(operation: string) {
    super(`${LEGACY_SALES_EFFECT_REASON} (${operation})`);
    this.name = "LegacySalesEffectDisabledError";
    this.operation = operation;
  }
}

/**
 * Legacy monolithic Sales fixtures are allowed only in an explicit synthetic
 * acceptance runtime with memory storage and every reachable provider forced
 * inert. Provider-backed and PostgreSQL runtimes fail closed before resolving
 * adapters or writing CRM data.
 */
export function legacySalesSyntheticRuntimeEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const mode = (key: string) => environment[key]?.trim().toLowerCase();
  const blank = (key: string) => !environment[key]?.trim();
  return (
    mode("AUTH_MODE") === "dev" &&
    environment.ALLOW_DEV_AUTH === "true" &&
    mode("DATABASE_MODE") === "memory" &&
    mode("WORK_ENVIRONMENT_KIND") === "sandbox" &&
    mode("LLM_PROVIDER") === "mock" &&
    mode("EMBEDDING_PROVIDER") === "none" &&
    mode("APOLLO_MODE") === "mock" &&
    environment.APOLLO_ALLOW_PAID_OPERATIONS === "false" &&
    mode("HUNTER_MODE") === "mock" &&
    environment.HUNTER_ALLOW_PAID_OPERATIONS === "false" &&
    mode("NEVERBOUNCE_MODE") === "mock" &&
    environment.NEVERBOUNCE_ALLOW_PAID_OPERATIONS === "false" &&
    mode("RESEND_MODE") === "mock" &&
    mode("XERO_MODE") === "mock" &&
    environment.XERO_WRITE_ENABLED === "false" &&
    blank("COMPOSIO_API_KEY") &&
    blank("GOOGLE_CHAT_WEBHOOK_URL")
  );
}

export function legacySalesEffectRefusal(operation: string) {
  return {
    ok: false as const,
    skipped: LEGACY_SALES_EFFECT_SKIPPED,
    operation,
    step: "legacy_effect_disabled" as const,
    reason: LEGACY_SALES_EFFECT_REASON,
    next: "/crm/hunt" as const,
  };
}

/**
 * Defense-in-depth for legacy service functions that can be imported without
 * going through their guarded routers or agent tools.
 */
export function assertLegacySalesSyntheticRuntime(
  operation: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!legacySalesSyntheticRuntimeEnabled(environment)) {
    throw new LegacySalesEffectDisabledError(operation);
  }
}
