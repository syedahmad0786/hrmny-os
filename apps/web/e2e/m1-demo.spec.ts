import { test, expect } from "@playwright/test";

/**
 * M1 demo script smoke (MASTER §12.1) — partner persona via x-dev-role header.
 */
test.describe("M1 substrate demo", () => {
  test.setTimeout(120_000);

  test("gate, roles, assets, connections pages load", async ({ page }) => {
    const goto = (path: string) =>
      page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });

    await goto("/gate");
    await expect(page.getByRole("heading", { name: /Gate demo/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("button", { name: /Trip health signal/i })).toBeVisible();

    await goto("/roles");
    await expect(page.locator("body")).toContainText(/role|margin|AM/i);

    await goto("/assets");
    await expect(page.locator("body")).toContainText(/asset|upload|DAM/i);

    await goto("/settings/connections");
    await expect(page.locator("body")).toContainText(/gmail|composio|connection/i);

    await goto("/conventions");
    await expect(page.getByRole("heading", { name: /Conventions/i })).toBeVisible();
  });

  test("illegal close shows GATE_BLOCKED result", async ({ page }) => {
    await page.goto("/gate", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByRole("button", { name: /close \(illegal/i }).click();
    await expect(page.locator("pre").filter({ hasText: "GATE_BLOCKED" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
