import { expect, test } from "@playwright/test";

/**
 * Sales Growth → advanced mock import → Open deal (mock-safe).
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
    await page.getByTestId("hunt-test-tools").click();
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

  test("free people search returns reviewable candidates without enriching", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await page
      .getByTestId("hunt-apollo-query")
      .fill("UAE retail marketing director");
    await page.getByTestId("hunt-apollo-search").click();
    await expect(page.getByTestId("hunt-apollo-search-status")).toContainText(
      /0 credits/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("hunt-apollo-results")).toBeVisible();
    await expect(
      page.getByTestId("hunt-apollo-enrich-one").first(),
    ).toBeVisible();
  });
});
