import { describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { createCaller } from "./trpc/root";

function caller(role: "traffic" | "hr") {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

describe("durable payroll authorization", () => {
  it("blocks ordinary staff before salary or payroll data reaches the database", async () => {
    const staff = caller("traffic");
    await expect(staff.workforcePayroll.runs.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      staff.workforcePayroll.salary.current({
        employeeId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails clearly when durable payroll is not connected to Postgres", async () => {
    await expect(
      caller("hr").workforcePayroll.runs.list(),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
