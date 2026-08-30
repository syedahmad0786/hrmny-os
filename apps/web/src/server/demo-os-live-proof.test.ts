/**
 * Separately authorized disposable-Postgres proof.
 *
 * The former test executed a monolithic prospect → provider import → won →
 * onboarding → portal → finance demo. That path conflicts with the accepted
 * Sales approval contract. The retained live-target test now proves those
 * compatibility mutations remain disabled even when a PostgreSQL target is
 * available. It performs no provider request or operational mutation.
 */
import { describe, expect, it, vi } from "vitest";
import { runAgentTools } from "./ai/agent-tools";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { LEGACY_SALES_EFFECT_SKIPPED } from "./sales-os/legacy-effect-policy";
import { createCaller } from "./trpc/root";

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

describe.runIf(hasDb)("legacy Sales live-target containment", () => {
  it("refuses every monolithic provider/CRM compatibility pathway", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network must remain unreachable"));
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
    });
    await expect(
      caller.crm.prospect.apolloImport({ query: "containment proof" }),
    ).resolves.toMatchObject({
      ok: false,
      skipped: LEGACY_SALES_EFFECT_SKIPPED,
      deals: [],
    });
    await expect(
      caller.leads.apollo.import({ query: "containment proof" }),
    ).resolves.toMatchObject({
      ok: false,
      skipped: LEGACY_SALES_EFFECT_SKIPPED,
      deals: [],
    });
    await expect(
      caller.deals.verifyEmail({
        id: "e0000000-0000-4000-8000-000000000001",
        email: "containment@example.com",
      }),
    ).resolves.toMatchObject({
      ok: false,
      skipped: LEGACY_SALES_EFFECT_SKIPPED,
      operation: "deals.verifyEmail",
    });

    const toolResults = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run closed loop via Apollo for company: Containment Proof",
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
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
