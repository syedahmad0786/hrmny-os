import { expect, test } from "@playwright/test";

/**
 * Outreach HITL: Create draft → Approve draft via UI (mock-safe).
 * Does not click Send via Gmail (needs live Gmail/Composio).
 */
test.describe("Outreach HITL UI", () => {
  test("Create draft then Approve draft without sending", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    const companyName = `Acceptance Outreach ${Date.now()}`;
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await page.getByTestId("hunt-test-tools").click();
    await page.getByTestId("hunt-synthetic-company").fill(companyName);
    await page.getByTestId("hunt-apollo-prospect").click();
    await expect(page.getByTestId("hunt-apollo-open-deal")).toBeVisible({
      timeout: 30_000,
    });
    await page.goto("/crm/outreach", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Outreach$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByText("Sending setup", { exact: true }).click();

    await expect(page.getByTestId("outreach-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("outreach-ready-gw")).toBeVisible();

    await page.getByRole("checkbox", { name: /Show test records/i }).check();
    const deal = page.getByTestId("outreach-draft-deal");
    await expect(deal).toBeVisible();
    await expect
      .poll(async () => deal.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);

    const option = deal.locator("option").filter({ hasText: companyName });
    await expect(option).toBeAttached();
    await deal.selectOption((await option.getAttribute("value"))!);

    const subject = `E2E HITL draft ${Date.now()}`;
    await page.getByTestId("outreach-draft-subject").fill(subject);
    await page
      .getByTestId("outreach-draft-body")
      .fill(
        `${companyName} team, this is a review-only campaign idea for a relevant hospitality story.`,
      );
    await page.getByTestId("outreach-draft-create").click();

    const showTestDrafts = page.getByRole("checkbox", {
      name: /Show test records/i,
    });
    await expect(showTestDrafts).toBeVisible({ timeout: 30_000 });
    await showTestDrafts.check();

    const draftRow = page
      .locator("[data-outreach-state='draft']")
      .filter({ hasText: subject });
    await expect(draftRow).toBeVisible({ timeout: 30_000 });

    await draftRow.getByTestId("outreach-approve").click();

    const approvedRow = page
      .locator("[data-outreach-state='approved']")
      .filter({ hasText: subject });
    await expect(approvedRow).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .locator("[data-outreach-state='draft']")
        .filter({ hasText: subject }),
    ).toHaveCount(0);

    // Explicitly never click Send via Gmail in this mock-safe path.
    await expect(
      approvedRow.getByRole("button", { name: /Send via Gmail/i }),
    ).toBeVisible();
    await expect(
      approvedRow.getByRole("button", { name: /Send test to myself/i }),
    ).toBeVisible();
    await expect(
      approvedRow.getByTestId("outreach-sender-account"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  });
});
