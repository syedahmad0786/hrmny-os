import { expect, test } from "@playwright/test";

/**
 * Connections live-demo blockers deep-link to Direct business cards
 * so humans can paste Apollo/Hunter / reconnect GW without scrolling blind.
 */
test.describe("Connections blocker anchors", () => {
  test("Apollo blocker scrolls to Apollo paste card", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Connections/i }),
    ).toBeVisible({ timeout: 60_000 });

    const apolloCard = page.getByTestId("conn-card-apollo");
    await expect(apolloCard).toBeVisible({ timeout: 30_000 });

    const apolloLink = page.getByTestId("connections-blocker-link-apollo");
    if ((await apolloLink.count()) > 0) {
      await apolloLink.click();
      await expect(apolloCard).toBeInViewport();
    }

    const hunterLink = page.getByTestId("connections-blocker-link-hunter");
    if ((await hunterLink.count()) > 0) {
      await hunterLink.click();
      await expect(page.getByTestId("conn-card-hunter")).toBeInViewport();
    }
  });
});
