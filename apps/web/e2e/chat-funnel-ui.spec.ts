import { expect, test } from "@playwright/test";

/**
 * Client-bound Chat remains a useful read/recommendation surface, but it must
 * not execute the former funnel action or mint portal effects.
 */
test.describe("Chat client review starter UI", () => {
  test("Demo Co sandbox starter stays read-only", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("chat-ready-strip")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("chat-toggle-synthetic").click();

    const sandbox = page.getByTestId("chat-sandbox-client");
    await expect(sandbox).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => sandbox.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);

    // Org scope hides the funnel starter (requires client sandbox).
    await sandbox.selectOption({ label: "Staff / org scope" });
    await expect(page.getByTestId("chat-starter-funnel")).toHaveCount(0);

    await sandbox.selectOption({ label: "Demo Co LLC" });
    await page.getByTestId("chat-new").click();
    await expect(page.getByTestId("chat-starter-funnel")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("chat-starter-funnel").click();

    await expect(page.getByTestId("chat-assistant-message")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("chat-work-steps")).toHaveCount(0);
    await expect(page.getByTestId("chat-tool-funnel_act")).toHaveCount(0);
    await expect(page.getByTestId("chat-tool-observation")).toHaveCount(0);
    await expect(page.getByTestId("chat-user-message")).toContainText(
      /review this client's funnel status/i,
    );
  });
});
