import { expect, test } from "@playwright/test";

const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";

/**
 * Staff Clients Sign off phase via UI (mock-safe).
 * Uses whichever onboarding phase is active so it coexists with portal
 * acknowledge e2es that also advance Demo Co phases.
 */
test.describe("Staff clients onboarding signoff UI", () => {
  test("Sign off phase notifies and deep-links phase focus", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(`/clients/${DEMO_CLIENT_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole("heading", { name: /Onboarding board/i }),
    ).toBeVisible();

    const active = page.locator('[data-phase-status="active"]').first();
    await expect(active).toBeVisible({ timeout: 30_000 });
    const phaseName = (await active.getAttribute("data-phase-name")) ?? "";
    const phaseIndex = Number(await active.getAttribute("data-phase-index"));
    expect(phaseName.length).toBeGreaterThan(0);
    expect(Number.isFinite(phaseIndex)).toBe(true);

    const target = page.locator(`[data-phase-index="${phaseIndex}"]`);
    await target.getByTestId("clients-onboarding-signoff").click();
    await expect(target).toHaveAttribute("data-phase-status", "signed_off", {
      timeout: 30_000,
    });

    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });

    // Match Open by phase= — "Advanced to {next}" text can make name filters
    // match multiple notification rows.
    const open = page.locator(
      `a[href*="/clients/"][href*="phase=${phaseIndex}"]`,
    );
    await expect(open.first()).toBeVisible({ timeout: 30_000 });
    await open.first().click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/.+\\?phase=${phaseIndex}`),
    );
    const focused = page.getByTestId("onboarding-phase-focus");
    await expect(focused).toBeVisible({ timeout: 60_000 });
    await expect(focused).toHaveAttribute(
      "id",
      `onboarding-phase-${phaseIndex}`,
    );
    await expect(focused).toContainText(phaseName);
  });
});
