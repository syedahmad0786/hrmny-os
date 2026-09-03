import { expect, test, type Page } from "@playwright/test";
import { advanceDealToClose } from "./sales-flow";

/** Seed JW Marriott deal already at propose (memory + SQL). */
const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

/** Advance won deal to handover next links (tolerates shared demo state). */
async function ensureDealHandoverNext(page: Page) {
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

  await advanceDealToClose(page);

  const markWon = page.getByTestId("deal-mark-won");
  if (await markWon.isVisible()) {
    await markWon.click();
    await expect(
      page
        .getByTestId("deal-handover")
        .or(page.getByTestId("deal-handover-next")),
    ).toBeVisible({ timeout: 30_000 });
  }

  const next = page.getByTestId("deal-handover-next");
  if (!(await next.isVisible())) {
    const handover = page.getByTestId("deal-handover");
    await expect(handover).toBeVisible({ timeout: 30_000 });
    await handover.click();
  }
  await expect(next).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("deal-handover-client")).toBeVisible();
}

/**
 * Sales → onboarding via deal UI (mock-safe).
 * Tolerates shared demo state when an earlier suite already advanced this seed.
 */
test.describe("Deal won → handover UI", () => {
  test("Advance, Mark won, Handover pack opens client onboarding", async ({
    page,
  }) => {
    await ensureDealHandoverNext(page);

    const finance = page.getByTestId("deal-handover-finance");
    await expect(finance).toBeVisible();
    await expect(finance).toHaveAttribute("href", /clientId=/);
    const creative = page.getByTestId("deal-handover-creative");
    await expect(creative).toBeVisible();
    await expect(creative).toHaveAttribute("href", /taskId=/);

    await creative.click();
    await expect(page).toHaveURL(/\/creative\?.*taskId=/);
    await expect(
      page.getByRole("heading", { name: /^Creative$/i }),
    ).toBeVisible({
      timeout: 60_000,
    });
  });

  test("Handover replay does not reissue portal access", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await ensureDealHandoverNext(page);

    await expect(page.getByTestId("deal-handover-client")).toBeVisible();
    await expect(page.getByTestId("deal-handover-finance")).toBeVisible();
    await expect(page.getByTestId("deal-handover-portal")).toHaveCount(0);
    await expect(
      page.getByTestId("deal-handover-onboarding-invite"),
    ).toHaveCount(0);
  });
});
