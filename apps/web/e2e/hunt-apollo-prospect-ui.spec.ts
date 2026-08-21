import { expect, test } from "@playwright/test";

/**
 * Hunt → Prospect with Apollo (mock) → Open deal (mock-safe).
 * Does not require a live Apollo key — demo store mock returns companies.
 */
test.describe("Hunt Apollo prospect UI", () => {
  test("Prospect with Apollo imports discover deal and opens detail", async ({
    page,
  }) => {
    const query = `E2E Apollo Retail ${Date.now()}`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId("hunt-apollo-query").fill(query);
    await page.getByTestId("hunt-apollo-prospect").click();

    const status = page.getByTestId("hunt-closed-loop-status");
    await expect(status).toContainText(/Apollo \(mock/i, { timeout: 30_000 });
    await expect(status).toContainText(/discover deal/i);

    const open = page.getByTestId("hunt-apollo-open-deal");
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", /\/crm\/deals\//);
    await open.click();

    await expect(page).toHaveURL(/\/crm\/deals\/[0-9a-f-]{36}/i, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/discover/i);
    await expect(page.locator("body")).toContainText(/apollo/i);
  });
});
