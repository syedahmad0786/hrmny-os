import { describe, expect, it } from "vitest";
import { createCaller } from "../trpc/root";

describe("inbound lead trust boundary", () => {
  it("does not expose lead creation through unauthenticated tRPC", async () => {
    const caller = createCaller({
      user: null,
      employeeId: null,
      roles: [],
      canViewMargin: false,
    });
    await expect(
      caller.leads.inbound.create({
        companyName: "Untrusted caller",
        contactEmail: "untrusted@example.com",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
