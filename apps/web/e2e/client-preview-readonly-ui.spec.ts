import { expect, test } from "@playwright/test";

test.describe("Client preview decision boundary", () => {
  test("staff preview is visibly read-only", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/client-preview", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Read-only partner preview")).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByText(/Inspect the current client projection without acting as the client/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Request changes", exact: true }),
    ).toHaveCount(0);
  });
});
