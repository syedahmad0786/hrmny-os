import { expect, test } from "@playwright/test";

/** Seed JW Marriott deal already at propose (memory + SQL). */
const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

/**
 * Sales → onboarding via deal UI (mock-safe).
 * Propose → Advance to price_cost → Mark won → Handover pack → Creative.
 * Tolerates shared demo state when an earlier suite already advanced this seed.
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
      await expect(
        page
          .getByTestId("deal-mark-won")
          .or(page.getByTestId("deal-handover"))
          .or(page.getByTestId("deal-handover-next")),
      ).toBeVisible({ timeout: 30_000 });
    }

    const markWon = page.getByTestId("deal-mark-won");
    if (await markWon.isVisible()) {
      await markWon.click();
      await expect(
        page
          .getByTestId("deal-handover")
          .or(page.getByTestId("deal-handover-next")),
      ).toBeVisible({ timeout: 30_000 });
    }

    const handover = page.getByTestId("deal-handover");
    if (await handover.isVisible()) {
      await handover.click();
    }

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
