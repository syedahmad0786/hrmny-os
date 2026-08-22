import { expect, test } from "@playwright/test";

/** Seed JW Marriott deal already at propose (memory + SQL). */
const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

/**
 * Sales → onboarding via deal UI (mock-safe).
 * Propose → Advance to price_cost → Mark won → Handover pack →
 * Portal approvals + Onboarding invite magic links → Creative.
 * Tolerates shared demo state when an earlier suite already advanced this seed.
 */
test.describe("Deal won → handover UI", () => {
  test("Advance, Mark won, Handover pack opens client onboarding", async ({
    page,
  }) => {
    test.setTimeout(180_000);
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

    const next = page.getByTestId("deal-handover-next");
    if (!(await next.isVisible())) {
      const handover = page.getByTestId("deal-handover");
      await expect(handover).toBeVisible({ timeout: 30_000 });
      await handover.click();
    }
    await expect(next).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("deal-handover-client")).toBeVisible();
    const finance = page.getByTestId("deal-handover-finance");
    await expect(finance).toBeVisible();
    await expect(finance).toHaveAttribute("href", /clientId=/);
    const creative = page.getByTestId("deal-handover-creative");
    await expect(creative).toBeVisible();
    await expect(creative).toHaveAttribute("href", /taskId=/);
    const creativeHref = await creative.getAttribute("href");
    expect(creativeHref).toBeTruthy();

    const portal = page.getByTestId("deal-handover-portal");
    await expect(portal).toBeVisible();
    await expect(portal).toHaveAttribute("href", /\/portal\/login\/verify/);
    const onboardingInvite = page.getByTestId("deal-handover-onboarding-invite");
    await expect(onboardingInvite).toBeVisible();
    await expect(onboardingInvite).toHaveAttribute("href", /\/portal\/login\/verify/);
    const onboardingHref = await onboardingInvite.getAttribute("href");
    expect(onboardingHref).toBeTruthy();
    expect(onboardingHref).not.toBe(await portal.getAttribute("href"));

    await portal.click();
    await expect(page).toHaveURL(/\/portal\/login\/verify/, { timeout: 60_000 });
    await expect(page).toHaveURL(/token=/);
    await expect(
      page.getByRole("heading", { name: /^Approvals$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/portal\/approvals/);

    await page.goto(onboardingHref!, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Onboarding$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/portal\/onboarding/);

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(creativeHref!, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/creative\?.*taskId=/);
    await expect(page.getByRole("heading", { name: /^Creative$/i })).toBeVisible({
      timeout: 60_000,
    });
  });
});
