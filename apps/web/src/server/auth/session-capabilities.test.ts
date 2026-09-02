import { describe, expect, it } from "vitest";
import { createCaller } from "../trpc/root";
import {
  resolveDevUser,
  rolesCanPreviewClient,
  sessionCanViewMargin,
} from "./session";

function callerFor(role: string) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

describe("staff session capabilities", () => {
  it("keeps the client preview role boundary aligned with the router", () => {
    expect(rolesCanPreviewClient(["partner"])).toBe(true);
    expect(rolesCanPreviewClient(["director"])).toBe(true);
    expect(rolesCanPreviewClient(["am"])).toBe(false);
    expect(rolesCanPreviewClient(["custom_role"])).toBe(false);
  });

  it("returns booleans rather than raw permission policies to the shell", async () => {
    const partner = resolveDevUser("partner");
    const am = resolveDevUser("am");
    await expect(callerFor("partner").auth.session()).resolves.toMatchObject({
      employeeId: partner.employeeId,
      actorType: "staff",
      canPreviewClient: true,
      canAdminFeatures: true,
      canAdminWork: true,
      canViewAudit: true,
    });
    await expect(callerFor("am").auth.session()).resolves.toMatchObject({
      employeeId: am.employeeId,
      actorType: "staff",
      canPreviewClient: false,
      canAdminFeatures: false,
      canAdminWork: false,
      canViewAudit: false,
    });
  });
});
