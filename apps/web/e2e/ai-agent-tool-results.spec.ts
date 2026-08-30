import { expect, test } from "@playwright/test";

/**
 * A client-bound custom-agent run is structurally read-only even when its
 * stored catalog contains draft tools. Typed draft command surfaces are tested
 * separately; this UI must not mint portal links or expose effect receipts.
 */
test.describe("Settings AI tool results", () => {
  test("Demo Co sandbox run does not execute catalogued draft tools", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/ai", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /AI control panel/i }),
    ).toBeVisible({ timeout: 60_000 });

    const sandbox = page.getByTestId("ai-sandbox-client");
    await expect(sandbox).toBeVisible();
    await expect
      .poll(async () => sandbox.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await sandbox.selectOption({ label: "Demo Co LLC" });

    const slug = `e2e-tools-${Date.now()}`;
    await page.getByTestId("ai-agent-slug").fill(slug);
    await page.getByTestId("ai-agent-name").fill("E2E Tool Coach");
    await page.getByTestId("ai-agent-create").click();
    await expect(page.getByTestId(`ai-agent-row-${slug}`)).toBeVisible({
      timeout: 30_000,
    });

    await page
      .getByTestId("ai-agent-run-prompt")
      .fill(
        "Invite the client portal and send creative cutdowns to portal review for Demo Co.",
      );
    await page.getByTestId(`ai-agent-run-${slug}`).click();

    const output = page.getByTestId("ai-agent-run-output");
    await expect(output).toBeVisible({ timeout: 60_000 });

    await expect(page.getByTestId("ai-agent-tool-results")).toHaveCount(0);
    await expect(page.getByTestId("ai-agent-tool-result-data")).toHaveCount(0);
    await expect(output).not.toContainText(/\/portal\/login\/verify\?token=/);
  });
});
