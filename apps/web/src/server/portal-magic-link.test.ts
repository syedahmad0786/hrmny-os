import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { DEMO_CLIENT_B_ID, DEMO_CLIENT_ID, getDemoStore } from "./demo-store";
import { clearDemoFeatureOverrides, setFeatureOverride } from "./features";
import {
  getPortalAllowlist,
  requestPortalMagicLink,
  resolvePortalSessionForEmail,
  verifyPortalMagicToken,
} from "./auth/portal-magic-link";

const ADMIN_ID = "c0000000-0000-4000-8000-000000000001";

/** Anonymous, pre-auth context for the public portal.auth.* procedures. */
const anon = createCaller({
  user: null,
  employeeId: null,
  roles: [],
  canViewMargin: false,
  clientId: null,
});

async function enableMagicLink() {
  await setFeatureOverride({
    featureKey: "portal.magic_link",
    scopeType: "global",
    scopeKey: "global",
    enabled: true,
    updatedByEmployeeId: ADMIN_ID,
  });
}

describe("portal magic-link", () => {
  beforeEach(() => {
    clearDemoFeatureOverrides();
    getDemoStore().portalMagicTokens.clear();
  });

  it("maps invited contacts to their client (case-insensitive)", async () => {
    const allow = await getPortalAllowlist();
    expect(allow.get("alex@democo.example")).toBe(DEMO_CLIENT_ID);
    expect(allow.get("ops@otherco.example")).toBe(DEMO_CLIENT_B_ID);
    expect(allow.get("stranger@evil.example")).toBeUndefined();

    // Requests normalize case before lookup.
    await enableMagicLink();
    await requestPortalMagicLink("ALEX@DemoCo.Example");
    const tokens = [...getDemoStore().portalMagicTokens.values()];
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.clientId).toBe(DEMO_CLIENT_ID);
  });

  it("flag on: response is identical for invited and unknown emails", async () => {
    await enableMagicLink();
    const invited = await anon.portal.auth.magicLink({
      email: "alex@democo.example",
    });
    const unknown = await anon.portal.auth.magicLink({
      email: "stranger@evil.example",
    });
    expect(invited).toEqual(unknown);
    expect(invited).toEqual({
      sent: true,
      stubToken: undefined,
      reason: undefined,
    });
  });

  it("flag on: only invited emails mint a single-use token bound to their client", async () => {
    await enableMagicLink();

    await requestPortalMagicLink("stranger@evil.example");
    expect(getDemoStore().portalMagicTokens.size).toBe(0);

    await requestPortalMagicLink("ops@otherco.example");
    const tokens = [...getDemoStore().portalMagicTokens.values()];
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.clientId).toBe(DEMO_CLIENT_B_ID);

    const token = tokens[0]!.token;
    const first = verifyPortalMagicToken(token);
    expect(first).toMatchObject({ ok: true, clientId: DEMO_CLIENT_B_ID });
    // Reuse of the same link is rejected (single-use).
    expect(verifyPortalMagicToken(token).ok).toBe(false);
  });

  it("verify rejects and cleans up expired tokens", () => {
    getDemoStore().portalMagicTokens.set("ml_expired", {
      token: "ml_expired",
      clientId: DEMO_CLIENT_ID,
      expiresAt: Date.now() - 1000,
    });
    expect(verifyPortalMagicToken("ml_expired").ok).toBe(false);
    expect(getDemoStore().portalMagicTokens.has("ml_expired")).toBe(false);
  });

  it("binds a session to exactly the allowlisted client, denies un-invited emails", async () => {
    const session = await resolvePortalSessionForEmail("ops@otherco.example");
    expect(session).toMatchObject({
      actorType: "portal",
      clientId: DEMO_CLIENT_B_ID,
      roles: ["portal_client"],
    });
    expect(session?.permissions).toContain("deny:margin:view");
    expect(session?.permissions).toContain("deny:payroll:*");

    expect(await resolvePortalSessionForEmail("stranger@evil.example")).toBeNull();
  });

  it("flag off: request keeps the existing dev-stub behavior", async () => {
    // No override set → flag off → legacy path returns a stub token.
    const result = await anon.portal.auth.magicLink({
      email: "alex@democo.example",
    });
    expect(result).toEqual({
      sent: true,
      stubToken: expect.any(String),
      reason: undefined,
    });
  });
});
