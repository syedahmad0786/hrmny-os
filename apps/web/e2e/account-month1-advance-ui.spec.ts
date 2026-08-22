import { expect, test } from "@playwright/test";

const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";

/**
 * Account Month-1 Advance via UI (mock-safe).
 * Seeds first phase active; Advance moves to the next phase.
 */
test.describe("Account Month-1 Advance UI", () => {
  test("Advance moves active Month-1 phase forward", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(`/account?clientId=${DEMO_CLIENT_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: /^Account$/i })).toBeVisible(
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("account-ready-banner")).toBeVisible({
      timeout: 30_000,
    });

    await expect(
      page.getByRole("heading", { name: /Month-1 phases/i }),
    ).toBeVisible();

    const active = page
      .locator('[data-testid="account-month1-phase"][data-phase-status="active"]')
      .first();
    await expect(active).toBeVisible({ timeout: 30_000 });
    const fromIndex = Number(await active.getAttribute("data-phase-index"));
    expect(Number.isFinite(fromIndex)).toBe(true);
    expect(fromIndex).toBeLessThan(6);

    await active.getByTestId("account-month1-advance").click();

    const prior = page.locator(
      `[data-testid="account-month1-phase"][data-phase-index="${fromIndex}"]`,
    );
    await expect(prior).toHaveAttribute("data-phase-status", "done", {
      timeout: 30_000,
    });
    const next = page.locator(
      `[data-testid="account-month1-phase"][data-phase-index="${fromIndex + 1}"]`,
    );
    await expect(next).toHaveAttribute("data-phase-status", "active", {
      timeout: 30_000,
    });
  });
});
