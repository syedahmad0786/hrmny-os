import { beforeEach, describe, expect, it } from "vitest";
import { createResendMock } from "@hrmny/integrations";
import { createCaller } from "./trpc/root";
import { DEMO_CLIENT_B_ID, DEMO_CLIENT_ID, getDemoStore } from "./demo-store";
import { clearDemoFeatureOverrides, setFeatureOverride } from "./features";
import {
  getPortalAllowlist,
  issuePortalMagicToken,
  requestPortalMagicLink,
  resolvePortalSessionForEmail,
  sendPortalInviteMagicLink,
  upsertPortalAllowlistContact,
  verifyPortalMagicToken,
} from "./auth/portal-magic-link";
import { getSupabasePublicConfig } from "@/lib/supabase-config";

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
  beforeEach(async () => {
    clearDemoFeatureOverrides();
    getDemoStore().portalMagicTokens.clear();
    await upsertPortalAllowlistContact({
      email: "alex@democo.example",
      clientId: DEMO_CLIENT_ID,
    });
    await upsertPortalAllowlistContact({
      email: "ops@otherco.example",
      clientId: DEMO_CLIENT_B_ID,
    });
  });

  it("maps invited contacts to their client (case-insensitive)", async () => {
    const allow = await getPortalAllowlist();
    expect(allow.get("alex@democo.example")).toBe(DEMO_CLIENT_ID);
    expect(allow.get("ops@otherco.example")).toBe(DEMO_CLIENT_B_ID);
    expect(allow.get("stranger@evil.example")).toBeUndefined();
  });

  it("flag on: response is identical for invited and unknown emails", async () => {
    await enableMagicLink();
    const invited = await anon.portal.auth.magicLink({
      email: "alex@democo.example",
    });
    const unknown = await anon.portal.auth.magicLink({
      email: "stranger@evil.example",
    });
    // Enumeration-safe: same public fields. stubToken may appear only in
    // non-Supabase envs for invited emails — strip before compare.
    expect({
      sent: invited.sent,
      reason: invited.reason,
    }).toEqual({
      sent: unknown.sent,
      reason: unknown.reason,
    });
    expect(invited.sent).toBe(true);
  });

  it("issues single-use tokens bound to a client", async () => {
    const token = await issuePortalMagicToken({
      clientId: DEMO_CLIENT_B_ID,
      email: "ops@otherco.example",
    });
    expect(token.startsWith("ml_")).toBe(true);
    const first = await verifyPortalMagicToken(token);
    expect(first).toMatchObject({ ok: true, clientId: DEMO_CLIENT_B_ID });
    if (first.ok) expect(first.sessionGrant.startsWith("ps_")).toBe(true);
    expect((await verifyPortalMagicToken(token)).ok).toBe(false);
  });

  it("verify rejects expired memory tokens", async () => {
    getDemoStore().portalMagicTokens.set("ml_expired", {
      token: "ml_expired",
      clientId: DEMO_CLIENT_ID,
      expiresAt: Date.now() - 1000,
    });
    expect((await verifyPortalMagicToken("ml_expired")).ok).toBe(false);
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
    if (getSupabasePublicConfig() && process.env.AUTH_MODE === "supabase") {
      // Production auth path — stub token not returned.
      return;
    }
    await setFeatureOverride({
      featureKey: "portal.magic_link",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      updatedByEmployeeId: ADMIN_ID,
    });
    const result = await anon.portal.auth.magicLink({
      email: "alex@democo.example",
    });
    expect(result.sent).toBe(true);
    expect(result.stubToken ?? result.reason).toBeTruthy();
  });

  it("flag on by default: public magicLink stays enumeration-safe", async () => {
    const invited = await anon.portal.auth.magicLink({
      email: "alex@democo.example",
    });
    expect(invited.sent).toBe(true);
    expect(invited.stubToken).toBeUndefined();
  });

  it("requestPortalMagicLink no-ops unknown emails", async () => {
    await enableMagicLink();
    await requestPortalMagicLink("stranger@evil.example");
    // No memory token for unknown; durable path also no-ops.
    expect(getDemoStore().portalMagicTokens.size).toBe(0);
  });

  it("sendPortalInviteMagicLink emails a verify URL via Resend mock", async () => {
    const emailer = createResendMock();
    const invite = await sendPortalInviteMagicLink({
      clientId: DEMO_CLIENT_ID,
      email: "alex@democo.example",
      displayName: "Alex Demo",
      emailer,
    });
    expect(invite.token.startsWith("ml_")).toBe(true);
    expect(invite.portalPath).toContain(
      `/portal/login/verify?token=${encodeURIComponent(invite.token)}`,
    );
    expect(invite.delivery.mode).toBe("mock");
    const recorded = emailer.recorded();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.to).toEqual(["alex@democo.example"]);
    expect(recorded[0]?.subject).toMatch(/portal/i);
  });
});
