import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "./root";

function partnerCaller() {
  const user = resolveDevUser("partner");
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("analytics ads bridge", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("honours live mode and fails loud while provider reads are unimplemented", async () => {
    vi.stubEnv("ADS_INSIGHTS_MODE", "live");
    await expect(
      partnerCaller().analytics.adsInsights({ platform: "meta" }),
    ).rejects.toThrow(/Live ads insights are not wired/);
  });
});
