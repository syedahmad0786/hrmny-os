import { expect, test } from "@playwright/test";

/**
 * Chat org-scope OS settle agent (mock-safe).
 * Selects seeded os-settle agent and runs the settle starter so
 * agents-on-command is proven on the primary staff Chat surface.
 *
 * Note: agent_act observations are truncated to 4k; closed_loop may fall
 * past the slice when many read tools run first. Next-link chips are
 * asserted on the client funnel starter (chat-funnel-ui) instead.
 */
test.describe("Chat OS settle agent UI", () => {
  test("os-settle agent runs agent_act closed loop from starter", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const sandbox = page.getByTestId("chat-sandbox-client");
    await expect(sandbox).toBeVisible({ timeout: 60_000 });
    await sandbox.selectOption({ label: "Staff / org scope" });

    const agent = page.getByTestId("chat-agent-slug");
    await expect(agent).toBeVisible();
    await expect
      .poll(async () => agent.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await agent.selectOption({ value: "os-settle" });
    await expect(page.getByTestId("chat-agent-hint")).toBeVisible();
    await expect(page.getByTestId("chat-context-banner")).toBeVisible();
    await expect(page.getByTestId("chat-pill-agent")).toContainText(/OS settle/i);
    await expect(page.getByTestId("chat-agent-tools-preview")).toBeVisible();

    await page.getByTestId("chat-new").click();
    await expect(page.getByTestId("chat-starter-os-settle")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("chat-starter-os-settle").click();

    const work = page.getByTestId("chat-work-steps");
    await expect(work).toBeVisible({ timeout: 90_000 });
    const agentAct = page.getByTestId("chat-tool-agent_act");
    await expect(agentAct).toBeVisible({ timeout: 60_000 });
    await expect(agentAct.getByTestId("chat-tool-observation")).toBeVisible();
    await expect(page.getByTestId("chat-assistant-message")).toBeVisible();
  });
});
