import { expect, test } from "@playwright/test";

/**
 * Hunt readiness banner mirrors /api/ready blockers with deep links
 * into Connections (same anchors as settings/connections).
 */
test.describe("Hunt ready blockers", () => {
  test("Apollo blocker deep-links to Connections Apollo card", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("hunt-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("hunt-runtime-llm")).toBeVisible();
    await expect(page.getByTestId("hunt-runtime-llm")).toContainText(/mock|openrouter/i);

    const blockers = page.getByTestId("hunt-ready-blockers");
    await expect(blockers).toBeVisible();

    const apolloLink = page.getByTestId("hunt-blocker-link-apollo");
    if ((await apolloLink.count()) > 0) {
      await apolloLink.click();
      await expect(page).toHaveURL(/\/settings\/connections/);
      const apolloCard = page.getByTestId("conn-card-apollo");
      await expect(apolloCard).toBeVisible({ timeout: 30_000 });
      await apolloCard.scrollIntoViewIfNeeded();
      await expect(apolloCard).toBeInViewport();
    }

    const hunterLink = page.getByTestId("hunt-blocker-link-hunter");
    if ((await hunterLink.count()) > 0) {
      await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
      await hunterLink.click();
      await expect(page).toHaveURL(/\/settings\/connections#?conn-hunter/);
      await expect(page.getByTestId("conn-card-hunter")).toBeInViewport();
    }
  });
});
