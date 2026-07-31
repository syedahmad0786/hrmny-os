import { test, expect } from "@playwright/test";

/**
 * M1 demo script smoke (MASTER §12.1) — partner persona via x-dev-role header.
 */
test.describe("M1 substrate demo", () => {
  test.setTimeout(120_000);

  test("M1 production surfaces load", async ({ page }) => {
    const goto = (path: string) =>
      page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });

    await goto("/roles");
    await expect(
      page.getByRole("heading", { name: /Roles & access/i }),
    ).toBeVisible();

    await goto("/settings/connections");
    await expect(page.locator("body")).toContainText(/current provider state/i);

    await goto("/conventions");
    await expect(
      page.getByRole("heading", { name: /Conventions/i }),
    ).toBeVisible();

    await goto("/admin/audit");
    await expect(
      page.getByRole("heading", { name: /Audit log/i }),
    ).toBeVisible();
  });

  test("Work Files creates, versions and QCs an asset", async ({ page }) => {
    await page.goto("/work", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .getByText("Confirm Asana workspace connection", { exact: true })
      .click();
    await expect(page.getByText("Versioned creative assets")).toBeVisible();

    const title = `M1 proof ${Date.now()}`;
    await page.getByPlaceholder("Asset title").fill(title);
    await page.getByRole("button", { name: "Create asset" }).click();
    const card = page.locator("article").filter({ hasText: title });
    await expect(card).toContainText("0 versions");

    const upload = card.locator('input[type="file"]');
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await upload.setInputFiles({
      name: "m1-proof-v1.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(card).toContainText("1 version");
    await upload.setInputFiles({
      name: "m1-proof-v2.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(card).toContainText("2 versions");
    await card.getByRole("button", { name: "Pass QC" }).click();
    await expect(card).toContainText("qc_passed");

    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText("assets.qc");
  });
});
