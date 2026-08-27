import { expect, test } from "@playwright/test";

/**
 * Connections live-demo blockers deep-link to Direct business cards
 * so humans can paste Apollo / reconnect GW without scrolling blind.
 */
test.describe("Connections blocker anchors", () => {
  test("Apollo blocker scrolls to Apollo paste card", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Connections/i }),
    ).toBeVisible({ timeout: 60_000 });

    const platform = page.getByTestId("connections-platform-ready");
    await expect(platform).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connections-platform-ready-llm")).toContainText(
      /mock|openrouter/i,
    );
    await expect(page.getByTestId("connections-platform-ready-db")).toContainText(
      /pgvector/i,
    );

    const apolloCard = page.getByTestId("conn-card-apollo");
    await expect(apolloCard).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("connections-blocker-link-apollo")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("connections-blocker-link-hunter")).toHaveCount(
      0,
    );
    await expect(page.getByText(/Live demo blockers/i)).toHaveCount(0);
  });
});
