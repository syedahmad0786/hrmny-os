import { expect, test } from "@playwright/test";

/** JW Marriott seed deal at propose (before deal-won e2e advances it). */
const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

/**
 * Commercial panel: Save quote version via UI (mock-safe).
 * Partner role so cost/margin fields are visible.
 */
test.describe("CRM quote Save version UI", () => {
  test("Save version shows Saved vN and margin", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/quote", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Commercial panel/i }),
    ).toBeVisible({ timeout: 60_000 });

    const deal = page.getByTestId("quote-deal-select");
    await expect(deal).toBeVisible();
    await expect
      .poll(async () => deal.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await deal.selectOption(PROPOSE_DEAL_ID);

    const line = page.getByTestId("quote-line").first();
    await expect(line).toBeVisible({ timeout: 30_000 });
    await line.getByTestId("quote-line-label").fill("E2E retainer package");
    await line.getByTestId("quote-line-qty").fill("1");
    await line.getByTestId("quote-line-sell").fill("85000");
    await line.getByTestId("quote-line-cost").fill("48000");

    await page.getByTestId("quote-save").click();
    const status = page.getByTestId("quote-save-status");
    await expect(status).toContainText(/Saved draft v\d+/i, {
      timeout: 30_000,
    });
    await expect(status).toContainText(/No discount approval needed|Tier/i);
    // Partner sees computed margin after save.
    await expect(page.locator(".crm-metric strong")).toContainText(/\d+\.\d%/);
  });
});
