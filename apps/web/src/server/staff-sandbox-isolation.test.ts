process.env.LLM_PROVIDER = "mock";
process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { getDemoStore } from "./demo-store";

function callerFor(role: "partner" | "finance" | "am") {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

describe("staff sandbox isolation", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "mock";
    process.env.DATABASE_URL = "";
    getDemoStore().resetM6Demo();
  });

  it("keeps chat threads isolated between partner and finance", async () => {
    const partner = callerFor("partner");
    const finance = callerFor("finance");
    const title = `Partner private thread ${Date.now()}`;

    const created = await partner.chat.createThread({ title });
    expect(created.employeeId).toBe(resolveDevUser("partner").employeeId);

    const partnerThreads = await partner.chat.listThreads();
    expect(partnerThreads.some((t) => t.chatThreadId === created.chatThreadId)).toBe(
      true,
    );

    const financeThreads = await finance.chat.listThreads();
    expect(
      financeThreads.some((t) => t.chatThreadId === created.chatThreadId),
    ).toBe(false);

    await expect(
      finance.chat.messages({ threadId: created.chatThreadId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scopes custom agent user-sandbox runs to the acting employee", async () => {
    const partner = callerFor("partner");
    const finance = callerFor("finance");

    const agent = await partner.aiAdmin.customAgents.create({
      slug: `staff-iso-${Date.now()}`,
      displayName: "Staff Isolation Coach",
      systemPrompt: "Stay inside the acting employee sandbox.",
    });

    const partnerRun = await partner.aiAdmin.customAgents.run({
      id: agent.customAgentId,
      prompt: `Partner-only note ${Date.now()} for user sandbox`,
    });
    expect(partnerRun.sandbox?.employeeId).toBe(
      resolveDevUser("partner").employeeId,
    );
    expect(partnerRun.sandbox?.clientId).toBeUndefined();

    const financeRun = await finance.aiAdmin.customAgents.run({
      id: agent.customAgentId,
      prompt: `Finance-only note ${Date.now()} for user sandbox`,
    });
    expect(financeRun.sandbox?.employeeId).toBe(
      resolveDevUser("finance").employeeId,
    );
    expect(financeRun.sandbox?.employeeId).not.toBe(
      partnerRun.sandbox?.employeeId,
    );
  });

  it("forbids non-admin staff from creating custom agents", async () => {
    const am = callerFor("am");
    await expect(
      am.aiAdmin.customAgents.create({
        slug: `am-blocked-${Date.now()}`,
        displayName: "Should Fail",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
