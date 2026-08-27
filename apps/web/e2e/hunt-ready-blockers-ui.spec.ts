import { expect, test } from "@playwright/test";

/**
 * Hunt stays open. Optional tools are not shown as a blocker wall.
 */
test.describe("Hunt ready blockers", () => {
  test("Hunt is open without a demo-blocker list", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("hunt-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("hunt-runtime-llm")).toBeVisible();
    await expect(page.getByTestId("hunt-runtime-llm")).toContainText(
      /mock|openrouter/i,
    );

    await expect(page.getByTestId("hunt-ready-blockers")).toHaveCount(0);
    await expect(page.getByTestId("hunt-ready-clear")).toBeVisible();
    await expect(page.getByTestId("hunt-blocker-link-hunter")).toHaveCount(0);
    await expect(page.getByTestId("hunt-blocker-link-apollo")).toHaveCount(0);
  });
});
