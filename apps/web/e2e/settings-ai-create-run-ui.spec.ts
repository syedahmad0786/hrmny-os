import { expect, test } from "@playwright/test";

/**
 * Settings AI: create agent → run on Demo Co sandbox (mock-safe).
 * Dedicated file so agents-on-command stays a first-class CI path
 * outside funnel-demo (pairs with Delivery Run agent #158).
 */
test.describe("Settings AI create → run UI", () => {
  test("create agent then Run on Demo Co sandbox", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/ai", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /AI control panel/i }),
    ).toBeVisible({ timeout: 60_000 });

    const sandbox = page.getByTestId("ai-sandbox-client");
    await expect(sandbox).toBeVisible();
    await expect
      .poll(async () => sandbox.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await sandbox.selectOption({ label: "Demo Co LLC" });

    const slug = `e2e-cmd-${Date.now()}`;
    await page.getByTestId("ai-agent-slug").fill(slug);
    await page.getByTestId("ai-agent-name").fill("E2E Command Coach");
    await page.getByTestId("ai-agent-create").click();

    const row = page.getByTestId(`ai-agent-row-${slug}`);
    await expect(row).toBeVisible({ timeout: 30_000 });

    await page
      .getByTestId("ai-agent-run-prompt")
      .fill("E2E dedicated: one next onboarding action for this client sandbox.");
    await page.getByTestId(`ai-agent-run-${slug}`).click();

    const output = page.getByTestId("ai-agent-run-output");
    await expect(output).toBeVisible({ timeout: 60_000 });
    await expect(output).not.toBeEmpty();
    await expect(output).toContainText(/\w{12,}/);
  });
});
