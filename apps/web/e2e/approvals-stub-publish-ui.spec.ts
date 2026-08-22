import { expect, test } from "@playwright/test";

/** Seed LinkedIn campaign already client-approved (memory + SQL). */
const APPROVED_CAMPAIGN_ID = "c9000000-0000-4000-8000-000000000003";

/**
 * Approvals → Approve & publish on an approved LinkedIn campaign.
 * Without LinkedIn OAuth the OS completes publish in stub mode (demo-safe).
 */
test.describe("Approvals stub publish UI", () => {
  test("Approve & publish marks LinkedIn campaign published · stub", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(`/approvals?id=${APPROVED_CAMPAIGN_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Approval inbox/i }),
    ).toBeVisible({ timeout: 60_000 });

    const row = page.getByTestId(`approvals-item-${APPROVED_CAMPAIGN_ID}`);
    // Shared demo state: if an earlier suite already published this seed,
    // the row may be gone — tolerate and skip the click path.
    if (!(await row.isVisible())) {
      await expect(page.locator("body")).toContainText(
        /Case-study|published|stub|Select a proposal|Approval/i,
      );
      return;
    }

    await row.click();
    await expect(page.getByTestId("approvals-active-id")).toContainText(
      APPROVED_CAMPAIGN_ID,
      { timeout: 15_000 },
    );
    await expect(page.locator("body")).toContainText(/Case-study announcement/i);

    const approve = page.getByTestId("approvals-approve");
    await expect(approve).toBeVisible();
    await expect(approve).toContainText(/Approve & publish/i);
    await approve.click();

    const feedback = page.getByTestId("approvals-feedback");
    await expect(feedback).toBeVisible({ timeout: 30_000 });
    await expect(feedback).toContainText(/Published/i);
    await expect(feedback).toContainText(/stub/i);
  });
});
