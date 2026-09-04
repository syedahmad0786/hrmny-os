process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { resetCrmMemory } from "../crm/memory";
import { createDeal } from "../crm/repository";
import { createCaller } from "./root";

function caller(role: string) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("CRM Sales AI authorization", () => {
  beforeEach(resetCrmMemory);

  it("lets a Sales operator run AI and denies non-Sales staff", async () => {
    const deal = await createDeal({ companyName: "Sales AI Fixture" });

    await expect(
      caller("am").crmAi.rescoreBuaf({ dealId: deal.dealId }),
    ).resolves.toMatchObject({ output: { deal: { dealId: deal.dealId } } });
    await expect(
      caller("hr").crmAi.rescoreBuaf({ dealId: deal.dealId }),
    ).rejects.toThrow(/Sales operator role required/i);
  });
});
