import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaller } from "./trpc/root";
import {
  getAuthMode,
  resolveDevUser,
  sessionCanViewMargin,
} from "./auth/session";
import { createContext } from "./trpc/trpc";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { issuePortalMagicToken } from "./auth/portal-magic-link";
import { DEMO_CLIENT_ID } from "./demo-store";

/**
 * M1 security / insurance checks — RLS SQL grants, margin strip, secrets hygiene.
 */
describe("M1 security insurance", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("Data API lockdown protects audit and asset history", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0005_lock_down_data_api.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0005_lock_down_data_api.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0005_lock_down_data_api.sql",
      ),
    ];
    const path = candidates.find((p) => existsSync(p));
    expect(path, "Data API lockdown migration not found").toBeTruthy();
    const sql = readFileSync(path!, "utf8");
    expect(sql).toMatch(/ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC/i,
    );
    expect(sql).toMatch(/'audit_event'/);
    expect(sql).toMatch(/'asset_version'/);
  });

  it("gitignore keeps secrets out of the monorepo", () => {
    const candidates = [
      join(process.cwd(), ".gitignore"),
      join(process.cwd(), "../../.gitignore"),
      join(__dirname, "../../../../.gitignore"),
    ];
    const path = candidates.find((p) => existsSync(p));
    expect(path).toBeTruthy();
    const gi = readFileSync(path!, "utf8");
    expect(gi).toMatch(/\.env/);
    expect(gi).toMatch(/\.env\.local/);
  });

  it("portal session never claims margin view", async () => {
    const user = resolveDevUser("portal_a");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: false,
      clientId: user.clientId,
    });
    const session = await caller.portal.auth.session();
    expect(session.canViewMargin).toBe(false);
    expect("marginPct" in session).toBe(false);
  });

  it("portal actor is blocked from staff data at the tRPC boundary", async () => {
    const user = resolveDevUser("portal_a");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: false,
      clientId: user.clientId,
    });
    // Staff procedure — portalStaffBoundary must FORBID before any resolver/DB.
    await expect(caller.crm.deals.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("magic-link token verify is single-use", async () => {
    const token = await issuePortalMagicToken({
      clientId: DEMO_CLIENT_ID,
      email: "client@demo.local",
    });
    expect(token.startsWith("ml_")).toBe(true);
    const anon = createCaller({
      user: null,
      employeeId: null,
      roles: [],
      canViewMargin: false,
      clientId: null,
    });
    const ok = await anon.portal.auth.verify({ token });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.clientId).toBe(DEMO_CLIENT_ID);
    const reuse = await anon.portal.auth.verify({ token });
    expect(reuse.ok).toBe(false);
  });

  it("never enables dev persona impersonation in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("ALLOW_DEV_AUTH", "");
    expect(getAuthMode()).toBe("supabase");

    const req = new Request("https://hrmny.example/api/trpc", {
      headers: {
        authorization: "not-a-valid-bearer-header",
        "x-dev-role": "partner",
      },
    });
    const ctx = await createContext({
      req,
    } as NonNullable<Parameters<typeof createContext>[0]>);
    expect(ctx.user).toBeNull();

    const partner = resolveDevUser("partner");
    const caller = createCaller({
      user: partner,
      employeeId: partner.employeeId,
      roles: partner.roles,
      canViewMargin: sessionCanViewMargin(partner),
    });
    const magic = await caller.portal.auth.magicLink({
      email: "client@example.com",
    });
    // Never return a consumable stub token under production auth mode.
    expect(magic.stubToken).toBeUndefined();
  });

  it("allows explicit CI demo auth when ALLOW_DEV_AUTH=true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("ALLOW_DEV_AUTH", "true");
    expect(getAuthMode()).toBe("dev");
  });

  it("reports the configured monthly LLM cap", async () => {
    vi.stubEnv("LLM_MONTHLY_CAP_AED", "10");
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });

    const health = await caller.admin.health.get();
    expect(health.spendCaps.llmMonthlyAed).toBe(10);
  });
});
