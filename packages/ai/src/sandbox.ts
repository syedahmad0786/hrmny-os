import {
  createProvider,
  type CreateProviderConfig,
  type LLMProvider,
} from "./provider";

/**
 * Dual OpenRouter workspace split (client lock 14 Aug 2026).
 * - General: day-to-day agents — never inject salaries/finance.
 * - Privileged: separate API key + workspace for salaries/financials only.
 */

export type LlmWorkspaceKind = "general" | "privileged";

export const PRIVILEGED_DATA_DOMAINS = [
  "salary",
  "payroll_amount",
  "client_payment_terms",
  "margin_pct",
  "bank_account",
  "personal_financial",
] as const;

export type PrivilegedDataDomain = (typeof PRIVILEGED_DATA_DOMAINS)[number];

/** Roles that may invoke the privileged workspace. */
const PRIVILEGED_ROLES = new Set(["partner", "director", "finance", "hr"]);

export function roleMayUsePrivilegedWorkspace(roles: string[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.has(role));
}

export function createGeneralProvider(
  config: CreateProviderConfig = {},
): LLMProvider {
  return createProvider({
    ...config,
    openRouterApiKey:
      config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY,
  });
}

export function createPrivilegedProvider(
  config: CreateProviderConfig = {},
): LLMProvider {
  const key =
    config.openRouterApiKey ??
    process.env.OPENROUTER_PRIVILEGED_API_KEY ??
    process.env.OPENROUTER_API_KEY;
  // Prefer privileged key; fall back only in mock mode when unset.
  return createProvider({
    ...config,
    openRouterApiKey: key,
    provider:
      process.env.OPENROUTER_PRIVILEGED_API_KEY || process.env.OPENROUTER_API_KEY
        ? config.provider ??
          (process.env.LLM_PROVIDER as CreateProviderConfig["provider"])
        : "mock",
  });
}

export type SandboxDecision =
  | { allowed: true; workspace: LlmWorkspaceKind }
  | {
      allowed: false;
      reason: string;
      workspace: LlmWorkspaceKind;
    };

/**
 * Primary control: per-role sandbox. Instruction guardrails are secondary only.
 * Privileged domains require privileged workspace + privileged role.
 */
export function decideLlmSandbox(input: {
  roles: string[];
  domains?: PrivilegedDataDomain[];
  requestPrivileged?: boolean;
}): SandboxDecision {
  const needsPrivileged =
    input.requestPrivileged === true ||
    (input.domains ?? []).some((d) =>
      (PRIVILEGED_DATA_DOMAINS as readonly string[]).includes(d),
    );

  if (!needsPrivileged) {
    return { allowed: true, workspace: "general" };
  }

  if (!roleMayUsePrivilegedWorkspace(input.roles)) {
    return {
      allowed: false,
      reason:
        "Privileged finance/HR data is sandboxed — your role cannot query that workspace",
      workspace: "privileged",
    };
  }

  if (
    !process.env.OPENROUTER_PRIVILEGED_API_KEY &&
    process.env.LLM_PROVIDER === "openrouter"
  ) {
    return {
      allowed: false,
      reason:
        "OPENROUTER_PRIVILEGED_API_KEY missing — privileged workspace not configured",
      workspace: "privileged",
    };
  }

  return { allowed: true, workspace: "privileged" };
}

export function providerForSandbox(
  decision: Extract<SandboxDecision, { allowed: true }>,
  config?: CreateProviderConfig,
): LLMProvider {
  return decision.workspace === "privileged"
    ? createPrivilegedProvider(config)
    : createGeneralProvider(config);
}

/**
 * Data-plane sandbox tags for memory / agent context.
 * Chunks must carry matching clientId / employeeId metadata when scoped.
 */
export type MemorySandboxScope = {
  clientId?: string;
  employeeId?: string;
  dealId?: string;
  companyId?: string;
};

export function memorySandboxMetadata(
  scope: MemorySandboxScope,
): Record<string, string> {
  const meta: Record<string, string> = {};
  if (scope.clientId) meta.clientId = scope.clientId;
  if (scope.employeeId) meta.employeeId = scope.employeeId;
  if (scope.dealId) meta.dealId = scope.dealId;
  if (scope.companyId) meta.companyId = scope.companyId;
  return meta;
}
