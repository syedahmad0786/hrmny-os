import { expect, test } from "@playwright/test";

/**
 * Chat exposes the OS settle agent's reviewed catalog and can assess readiness,
 * but it must not auto-execute the catalog. Effectful settle remains an
 * explicit command in the AI control panel.
 */
test.describe("Chat OS settle agent UI", () => {
  test("os-settle agent reviews readiness without agent_act", async ({
    page,
  }) => {
    // Brief lock + full settle path regularly exceeds Playwright's 30s default.
    test.setTimeout(180_000);
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const runtime = page.getByTestId("chat-runtime-llm");
    await expect(runtime).toBeVisible({ timeout: 60_000 });
    await expect(runtime).toContainText(/mock/i);
    await expect(page.getByTestId("chat-ready-strip")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("chat-ready-connections")).toBeVisible();

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
    await expect(page.getByTestId("chat-agent-tools-preview")).toContainText(
      /closed_loop/i,
    );

    await page.getByTestId("chat-new").click();
    await expect(page.getByTestId("chat-pill-agent")).toContainText(/OS settle/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("chat-starter-os-settle")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("chat-starter-os-settle").click();

    await expect(page.getByTestId("chat-assistant-message")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("chat-work-steps")).toHaveCount(0);
    await expect(page.getByTestId("chat-tool-agent_act")).toHaveCount(0);
    await expect(page.getByTestId("chat-user-message")).toContainText(
      /review os settle readiness/i,
    );
  });
});
