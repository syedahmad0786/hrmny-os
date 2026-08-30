import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentTools } from "../ai/agent-tools";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { importApolloCompaniesToCrm } from "../crm/apollo-import";
import { runDemoClosedLoopCore } from "../crm/closed-loop";
import { resetCrmMemory } from "../crm/memory";
import { listCompanies, listContacts, listDeals } from "../crm/repository";
import { runDailyLeadGen } from "../leadgen/pipeline";
import { listOutreach, resetLeadgenStore } from "../leadgen/store";
import { createCaller } from "../trpc/root";
import {
  LEGACY_SALES_EFFECT_SKIPPED,
  legacySalesSyntheticRuntimeEnabled,
} from "./legacy-effect-policy";

const safeSyntheticEnvironment = {
  NODE_ENV: "test",
  AUTH_MODE: "dev",
  ALLOW_DEV_AUTH: "true",
  DATABASE_MODE: "memory",
  WORK_ENVIRONMENT_KIND: "sandbox",
  LLM_PROVIDER: "mock",
  EMBEDDING_PROVIDER: "none",
  APOLLO_MODE: "mock",
  APOLLO_ALLOW_PAID_OPERATIONS: "false",
  HUNTER_MODE: "mock",
  HUNTER_ALLOW_PAID_OPERATIONS: "false",
  NEVERBOUNCE_MODE: "mock",
  NEVERBOUNCE_ALLOW_PAID_OPERATIONS: "false",
  RESEND_MODE: "mock",
  XERO_MODE: "mock",
  XERO_WRITE_ENABLED: "false",
  COMPOSIO_API_KEY: "",
  GOOGLE_CHAT_WEBHOOK_URL: "",
} as const;

async function operationalSnapshot() {
  const [companies, contacts, deals, outreach] = await Promise.all([
    listCompanies(),
    listContacts(),
    listDeals(),
    listOutreach(),
  ]);
  return {
    companyIds: companies.map((row) => row.companyId).sort(),
    contactIds: contacts.map((row) => row.contactId).sort(),
    dealIds: deals.map((row) => row.dealId).sort(),
    outreachIds: outreach.map((row) => row.id).sort(),
  };
}

describe("legacy Sales effect policy", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetLeadgenStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("requires the exact local synthetic runtime", () => {
    expect(legacySalesSyntheticRuntimeEnabled(safeSyntheticEnvironment)).toBe(
      true,
    );
    expect(
      legacySalesSyntheticRuntimeEnabled({
        ...safeSyntheticEnvironment,
        DATABASE_MODE: "postgres",
      }),
    ).toBe(false);
    expect(
      legacySalesSyntheticRuntimeEnabled({
        ...safeSyntheticEnvironment,
        AUTH_MODE: "supabase",
      }),
    ).toBe(false);
    expect(
      legacySalesSyntheticRuntimeEnabled({
        ...safeSyntheticEnvironment,
        APOLLO_MODE: "live",
        APOLLO_ALLOW_PAID_OPERATIONS: "true",
      }),
    ).toBe(false);
  });

  it("keeps every legacy route and Chat tool inert outside that runtime", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("ALLOW_DEV_AUTH", "true");
    vi.stubEnv("DATABASE_MODE", "memory");
    vi.stubEnv("WORK_ENVIRONMENT_KIND", "sandbox");
    vi.stubEnv("EMBEDDING_PROVIDER", "none");
    vi.stubEnv("APOLLO_MODE", "live");
    vi.stubEnv("APOLLO_API_KEY", "must-not-be-used");
    vi.stubEnv("APOLLO_ALLOW_PAID_OPERATIONS", "true");
    vi.stubEnv("HUNTER_MODE", "live");
    vi.stubEnv("HUNTER_API_KEY", "must-not-be-used");
    vi.stubEnv("HUNTER_ALLOW_PAID_OPERATIONS", "true");
    vi.stubEnv("NEVERBOUNCE_MODE", "mock");
    vi.stubEnv("NEVERBOUNCE_ALLOW_PAID_OPERATIONS", "false");
    vi.stubEnv("RESEND_MODE", "mock");
    vi.stubEnv("XERO_MODE", "mock");
    vi.stubEnv("XERO_WRITE_ENABLED", "false");
    vi.stubEnv("COMPOSIO_API_KEY", "");
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "");
    vi.stubEnv("LLM_PROVIDER", "mock");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must remain unreachable"));
    const searchLeads = vi.fn();
    const enrichLead = vi.fn();
    const verify = vi.fn();
    const before = await operationalSnapshot();
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });

    await expect(
      caller.crm.runDemoClosedLoop({ viaApollo: true }),
    ).resolves.toMatchObject({
      ok: false,
      skipped: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "crm.runDemoClosedLoop",
    });
    await expect(
      caller.crm.prospect.apolloImport({ query: "must not run" }),
    ).resolves.toMatchObject({
      ok: false,
      skipped: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "crm.prospect.apolloImport",
      deals: [],
    });
    await expect(
      caller.leads.apollo.import({ query: "must not run" }),
    ).resolves.toMatchObject({
      ok: false,
      skipped: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "leads.apollo.import",
      deals: [],
    });
    await expect(
      caller.deals.verifyEmail({
        id: before.dealIds[0]!,
        email: "must-not-run@example.com",
      }),
    ).resolves.toMatchObject({
      ok: false,
      skipped: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "deals.verifyEmail",
      emailVerified: false,
    });

    const toolResults = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run closed loop via Apollo for company: Must Not Run",
      scope: { employeeId: user.employeeId },
    });
    expect(toolResults).toContainEqual(
      expect.objectContaining({
        tool: "crm.closed_loop",
        ok: false,
        data: expect.objectContaining({
          skipped: LEGACY_SALES_EFFECT_SKIPPED,
        }),
      }),
    );
    const prospectResults = await runAgentTools({
      allowedTools: ["crm.prospect"],
      prompt: "Find and import UAE retail brands with Apollo",
      scope: { employeeId: user.employeeId },
    });
    expect(prospectResults).toContainEqual(
      expect.objectContaining({
        tool: "crm.prospect",
        ok: false,
        data: expect.objectContaining({
          skipped: LEGACY_SALES_EFFECT_SKIPPED,
        }),
      }),
    );
    await expect(
      runDemoClosedLoopCore({ viaApollo: true }),
    ).rejects.toMatchObject({
      code: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "crm.runDemoClosedLoopCore",
    });
    await expect(
      importApolloCompaniesToCrm({
        query: "must not run",
        companies: [{ name: "Must Not Run" }],
        mode: "live",
      }),
    ).rejects.toMatchObject({
      code: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "crm.importApolloCompaniesToCrm",
    });
    await expect(
      runDailyLeadGen({
        leadSource: { mode: "live", searchLeads, enrichLead },
        verifier: { provider: "hunter", mode: "live", verify },
      }),
    ).rejects.toMatchObject({
      code: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "leadgen.runDailyLeadGen",
    });
    expect(searchLeads).not.toHaveBeenCalled();
    expect(enrichLead).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(operationalSnapshot()).resolves.toEqual(before);
  });
});
