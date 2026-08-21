import { expect, test } from "@playwright/test";

/**
 * Finance HITL: Intake → Approve proposal → Approve invoice → Mark issued.
 * Mock-safe — never writes to Xero (OS-only issue).
 */
test.describe("Finance invoice UI", () => {
  test("Intake through Mark issued (OS only)", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "finance" });
    await page.goto("/finance", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Finance queue/i }),
    ).toBeVisible({ timeout: 60_000 });

    // Unique amount so this run's invoice is findable among demo rows.
    const amount = `314${String(Date.now()).slice(-4)}.50`;
    const hint = `ACME Supplies LLC invoice AED ${amount} — TRN on file · e2e`;
    await page.getByTestId("finance-intake-hint").fill(hint);
    await page.getByTestId("finance-intake").click();

    const proposal = page
      .locator('[data-testid="finance-proposal"][data-proposal-status="pending"]')
      .filter({ hasText: amount })
      .first();
    await expect(proposal).toBeVisible({ timeout: 30_000 });
    await proposal.getByTestId("finance-approve-proposal").click();

    const invoice = page
      .locator('[data-testid="finance-invoice"]')
      .filter({ hasText: amount })
      .first();
    await expect(invoice).toHaveAttribute("data-invoice-status", "proposed", {
      timeout: 30_000,
    });
    await invoice.getByTestId("finance-approve-invoice").click();
    await expect(invoice).toHaveAttribute("data-invoice-status", "approved", {
      timeout: 30_000,
    });

    await invoice.getByTestId("finance-issue-invoice").click();
    await expect(invoice).toHaveAttribute("data-invoice-status", "issued", {
      timeout: 30_000,
    });
    // OS-only: no Xero write in mock mode.
    await expect(invoice).toContainText(/xero mirror id:\s*—/i);
  });
});
