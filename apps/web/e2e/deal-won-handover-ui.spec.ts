import { expect, test } from "@playwright/test";

/** Seed JW Marriott deal already at propose (memory + SQL). */
const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

/**
 * Sales → onboarding via deal UI (mock-safe).
 * Propose → Advance to price_cost → Mark won → Handover pack → client board.
 */
test.describe("Deal won → handover UI", () => {
  test("Advance, Mark won, Handover pack opens client onboarding", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(`/crm/deals/${PROPOSE_DEAL_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /JW Marriott/i,
    );

    // From propose → price_cost (Mark won is gated on price_cost|close).
    const advance = page.getByTestId("deal-advance");
    if (await advance.isVisible()) {
      await advance.click();
      await expect(page.getByTestId("deal-mark-won")).toBeVisible({
        timeout: 30_000,
      });
    }

    await page.getByTestId("deal-mark-won").click();
    await expect(page.getByTestId("deal-handover")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("deal-handover").click();
    const next = page.getByTestId("deal-handover-next");
    await expect(next).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("deal-handover-client")).toBeVisible();
    await expect(page.getByTestId("deal-handover-finance")).toBeVisible();
    const creative = page.getByTestId("deal-handover-creative");
    await expect(creative).toBeVisible();
    await expect(creative).toHaveAttribute("href", /taskId=/);

    await creative.click();
    await expect(page).toHaveURL(/\/creative\?.*taskId=/);
    await expect(page.getByRole("heading", { name: /Creative/i })).toBeVisible({
      timeout: 60_000,
    });
  });
});
