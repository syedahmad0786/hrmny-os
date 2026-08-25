import { expect, test } from "@playwright/test";

/**
 * Dedicated Google Workspace OAuth — Connect no longer uses Supabase SSO,
 * Heal is not auto-fired, and OAuth return banners are visible.
 */
test.describe("Connections Google Workspace OAuth", () => {
  test("mailbox card is first and OAuth banners render", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/connections?gw=error&reason=access_denied", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Connections/i }),
    ).toBeVisible({ timeout: 60_000 });

    const gwCard = page.getByTestId("conn-card-google_workspace");
    await expect(gwCard).toBeVisible({ timeout: 30_000 });
    await expect(gwCard.getByRole("heading", { name: /Google Workspace/i })).toBeVisible();

    const banner = page.getByTestId("connections-oauth-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText(/Google Workspace connect failed/i);
    await expect(banner).toContainText(/access_denied/);

    const cards = page.locator("[data-testid^='conn-card-']");
    await expect(cards.first()).toHaveAttribute(
      "data-testid",
      "conn-card-google_workspace",
    );

    await expect(page.getByText(/Add later/i)).toBeVisible();
    await expect(page.getByTestId("connections-blocker-link-apollo")).toBeVisible();

    await page.goto(
      "/settings/connections?gw=connected&account=developer%40hrmny.co",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("connections-oauth-banner")).toContainText(
      /Google Workspace connected/i,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("connections-oauth-banner")).toContainText(
      "developer@hrmny.co",
    );
  });

  test("HITL and Hunt deep-link to the mailbox card", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/outreach", { waitUntil: "domcontentloaded" });
    const gw = page.getByTestId("outreach-ready-gw");
    await expect(gw).toBeVisible({ timeout: 30_000 });
    const reconnect = gw.getByRole("link", { name: /Reconnect in Connections/i });
    if ((await reconnect.count()) > 0) {
      await expect(reconnect).toHaveAttribute(
        "href",
        "/settings/connections#conn-google_workspace",
      );
    }

    await page.goto("/crm/settings/sales-os", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sales-os-settings")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("link", { name: /Google Workspace/i }).first(),
    ).toHaveAttribute("href", "/settings/connections#conn-google_workspace");

    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hunt-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    const huntGw = page.getByTestId("hunt-blocker-link-google_workspace");
    if ((await huntGw.count()) > 0) {
      await huntGw.click();
      await expect(page).toHaveURL(/\/settings\/connections/);
      await expect(page.getByTestId("conn-card-google_workspace")).toBeVisible({
        timeout: 30_000,
      });
    }
  });
});
