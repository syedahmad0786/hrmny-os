import { expect, test } from "@playwright/test";

/**
 * Portal onboarding Acknowledge via real UI clicks (mock-safe).
 * Uses whichever phase is currently active so it coexists with the
 * API-based funnel-demo onboarding acknowledge spec.
 */
test.describe("Portal onboarding UI", () => {
  test("Acknowledge phase notifies partner and deep-links clients", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "portal_a" });
    await page.goto("/portal/onboarding", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Onboarding$/i }),
    ).toBeVisible({ timeout: 60_000 });

    const active = page.locator('[data-phase-status="active"]').first();
    await expect(active).toBeVisible({ timeout: 30_000 });
    const phaseName = (await active.getAttribute("data-phase-name")) ?? "";
    expect(phaseName.length).toBeGreaterThan(0);
    const phaseIndexAttr = await active.getAttribute("data-testid");
    const phaseIndex = Number(
      phaseIndexAttr?.replace("portal-onboarding-phase-", "") ?? "NaN",
    );
    expect(Number.isFinite(phaseIndex)).toBe(true);

    const target = page.getByTestId(`portal-onboarding-phase-${phaseIndex}`);
    await target.getByTestId("portal-onboarding-ack").click();
    await expect(target).toHaveAttribute("data-phase-status", "signed_off", {
      timeout: 30_000,
    });

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });

    // Match Open by phase= — prior signoffs say "Advanced to {next}" which
    // makes name filters match multiple notification rows.
    const open = page.locator(
      `a[href*="/clients/"][href*="phase=${phaseIndex}"]`,
    );
    await expect(open.first()).toBeVisible({ timeout: 30_000 });
    await open.first().click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/.+\\?phase=${phaseIndex}`),
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    const focused = page.getByTestId("onboarding-phase-focus");
    await expect(focused).toBeVisible();
    await expect(focused).toHaveAttribute(
      "id",
      `onboarding-phase-${phaseIndex}`,
    );
    await expect(focused).toContainText(phaseName);
  });
});
