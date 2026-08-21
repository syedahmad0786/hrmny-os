import { expect, test } from "@playwright/test";

/**
 * Portal Campaign Approvals UI closed-loop (mock-safe).
 * Uses dedicated seed titles so funnel-demo API campaign specs stay isolated.
 */
test.describe("Campaign approvals UI", () => {
  test("Request changes notifies partner and deep-links Approvals", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "portal_a" });
    await page.goto("/portal/campaign-approvals", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Campaign approvals/i }),
    ).toBeVisible({ timeout: 60_000 });

    const row = page
      .locator("[data-campaign-title]")
      .filter({ hasText: /UI E2E offer carousel/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveAttribute("data-campaign-state", "pending_client");

    await row.getByTestId("portal-campaign-reject").click();
    await row
      .getByTestId("portal-campaign-reject-reason")
      .fill("E2E UI: lead with the offer");
    await row.getByTestId("portal-campaign-reject-send").click();
    await expect(row).toHaveAttribute("data-campaign-state", "rejected", {
      timeout: 30_000,
    });

    const campaignItemId = "c9000000-0000-4000-8000-0000000000a1";
    const idEsc = campaignItemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("body")).toContainText(
      /Client campaign revisions/i,
    );
    await expect(page.locator("body")).toContainText(/UI E2E offer carousel/i);
    await expect(page.locator("body")).toContainText(
      /E2E UI: lead with the offer/i,
    );

    const openLink = page.locator(
      `a[href*="/approvals?id=${campaignItemId}"]`,
    );
    await expect(openLink).toBeVisible();
    await openLink.click();
    await expect(
      page.getByRole("heading", { name: /Approval inbox/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`id=${idEsc}`));
    await expect(page.locator("body")).toContainText(/UI E2E offer carousel/i);
    await expect(page.locator("body")).toContainText(
      /Client requested changes/i,
    );
    await expect(page.locator("body")).toContainText(
      /E2E UI: lead with the offer/i,
    );
  });

  test("Approve notifies partner and deep-links Approvals", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "portal_a" });
    await page.goto("/portal/campaign-approvals", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Campaign approvals/i }),
    ).toBeVisible({ timeout: 60_000 });

    const row = page
      .locator("[data-campaign-title]")
      .filter({ hasText: /UI E2E brand stills/i });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveAttribute("data-campaign-state", "pending_client");

    await row.getByTestId("portal-campaign-approve").click();
    await expect(row).toHaveAttribute("data-campaign-state", "approved", {
      timeout: 30_000,
    });

    const campaignItemId = "c9000000-0000-4000-8000-0000000000a2";
    const idEsc = campaignItemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });
    const approveRow = page
      .locator("li")
      .filter({ hasText: /Client approved campaign/i })
      .filter({ hasText: /UI E2E brand stills/i });
    await expect(approveRow).toBeVisible();

    const openLink = approveRow.locator(
      `a[href*="/approvals?id=${campaignItemId}"]`,
    );
    await expect(openLink).toBeVisible();
    await openLink.click();
    await expect(
      page.getByRole("heading", { name: /Approval inbox/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`id=${idEsc}`));
    await expect(page.locator("body")).toContainText(/UI E2E brand stills/i);
    await expect(page.locator("body")).toContainText(
      /approved and ready to publish/i,
    );
  });
});
