import { expect, test } from "@playwright/test";

/** Explicit synthetic acceptance fixtures; the normal Apollo surface remains
 * disconnected and fail-closed without a live, scoped provider credential. */
test.describe("Hunt Apollo prospect UI", () => {
  test("synthetic Apollo fixture imports discover deal and opens detail", async ({
    page,
  }) => {
    const query = `E2E Apollo Retail ${Date.now()}`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("hunt-apollo-query")).toBeDisabled();

    await page.getByTestId("hunt-test-tools").click();
    await expect(page.getByTestId("hunt-apollo-prospect")).toBeDisabled();
    await page.getByTestId("hunt-synthetic-company").fill(query);
    await expect(page.getByTestId("hunt-apollo-prospect")).toBeEnabled();
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

  test("free people search fails closed when Apollo is not connected", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    const search = page.getByTestId("hunt-apollo-search");
    await expect(search).toBeDisabled({ timeout: 60_000 });
    await expect(search).toHaveText(/Connect Apollo to search/i);
    await expect(page.getByTestId("hunt-apollo-results")).toHaveCount(0);
  });

  test("Sales Growth remains navigable at a narrow client viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Find the next right client." }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("navigation", { name: "CRM sections" }),
    ).toBeVisible();
    await expect(page.getByTestId("hunt-apollo-search")).toBeVisible();

    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);

    await page.keyboard.press("Control+k");
    await expect(page).toHaveURL(/\/work\/search$/);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Find the next right client." }),
    ).toBeVisible();

    await page
      .getByRole("navigation", { name: "CRM sections" })
      .locator("summary")
      .filter({ hasText: "More" })
      .click();
    await expect(page.getByRole("link", { name: "Companies" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sales settings" }),
    ).toBeVisible();
  });
});
