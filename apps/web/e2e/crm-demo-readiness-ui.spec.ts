import { expect, test } from "@playwright/test";

/** CRM pipeline demo readiness hub mirrors /api/ready blockers. */
test.describe("CRM demo readiness panel", () => {
  test("pipeline shows demo readiness strip with funnel links", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Pipeline$/i }),
    ).toBeVisible({ timeout: 60_000 });

    const panel = page.getByTestId("crm-demo-readiness");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("crm-demo-llm")).toBeVisible();
    await expect(page.getByTestId("crm-demo-blockers-count")).toBeVisible();
    await expect(panel.getByRole("link", { name: /Hunt closed loop/i })).toBeVisible();
    await expect(panel.getByRole("link", { name: /Connections/i })).toBeVisible();
  });
});
