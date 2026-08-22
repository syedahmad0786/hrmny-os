import { expect, test } from "@playwright/test";

/**
 * Automations settings: platform readiness + n8n smoke (mock-safe in CI).
 */
test.describe("Settings Automations UI", () => {
  test("platform strip and n8n smoke return health", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/automations", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Automations$/i }),
    ).toBeVisible({ timeout: 60_000 });

    const platform = page.getByTestId("automations-platform-ready");
    await expect(platform).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("automations-platform-ready-tools")).toContainText(
      /n8n/i,
    );

    await expect(page.getByTestId("automations-event-map")).toBeVisible();
    await expect(page.getByTestId("automations-event-deal.won")).toBeVisible();

    await page.getByTestId("automations-n8n-smoke").click();
    const result = page.getByTestId("automations-n8n-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("automations-n8n-live")).toContainText(
      /Live:/i,
    );
    await expect(page.getByTestId("automations-n8n-health")).toContainText(
      /Mode|workflows/i,
    );
  });
});
