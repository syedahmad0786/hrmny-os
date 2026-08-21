import { expect, test } from "@playwright/test";

/**
 * Inbound Capture → create discover-stage deal via UI (mock-safe).
 * Unique company/email so the run never collides with Demo Co seed.
 */
test.describe("CRM inbound Capture UI", () => {
  test("Review + create deal opens discover deal detail", async ({ page }) => {
    const ts = Date.now();
    const company = `E2E Inbound ${ts}`;
    const email = `e2e+inbound-${ts}@example.com`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/inbound", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Inbound leads/i }),
    ).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("inbound-company").fill(company);
    await page.getByTestId("inbound-contact-name").fill("E2E Lead");
    await page.getByTestId("inbound-email").fill(email);
    await page.getByTestId("inbound-sector").fill("Retail");
    await page.getByTestId("inbound-market").selectOption("UAE");
    await page
      .getByTestId("inbound-message")
      .fill("E2E inbound enquiry — prospecting entry.");

    await page.getByTestId("inbound-create-deal").click();

    await expect(page).toHaveURL(/\/crm\/deals\/[0-9a-f-]{36}/i, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      company,
      { timeout: 60_000 },
    );
    await expect(page.locator("body")).toContainText(/discover/i);
    await expect(page.getByTestId("deal-advance")).toBeVisible();
  });
});
