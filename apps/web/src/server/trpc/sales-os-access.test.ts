import { describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "./root";

function caller(role: "partner" | "am") {
  const user = resolveDevUser(role);
  return {
    employeeId: user.employeeId,
    caller: createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    }),
  };
}

describe("Sales OS principal-bound query state", () => {
  it("tags authorization and connection state with the verified principal", async () => {
    const partner = caller("partner");
    const am = caller("am");

    await expect(partner.caller.salesOs.access()).resolves.toMatchObject({
      canOperate: true,
      principalId: partner.employeeId,
    });
    const partnerConnection = await partner.caller.salesOs.apollo.connection();
    expect(partnerConnection).toMatchObject({
      principalId: partner.employeeId,
    });
    expect(typeof partnerConnection.configured).toBe("boolean");
    await expect(am.caller.salesOs.access()).resolves.toMatchObject({
      canOperate: true,
      principalId: am.employeeId,
    });
    const amConnection = await am.caller.salesOs.apollo.connection();
    expect(amConnection).toMatchObject({
      principalId: am.employeeId,
    });
    expect(typeof amConnection.configured).toBe("boolean");
    expect(partner.employeeId).not.toBe(am.employeeId);
  });
});
