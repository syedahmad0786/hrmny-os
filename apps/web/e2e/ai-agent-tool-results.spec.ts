import { expect, test } from "@playwright/test";

/**
 * Settings/AI on-command run surfaces funnel tool payloads (portal verify href).
 * Separate from funnel-demo.spec.ts so create→run and tool-payload proofs don't collide.
 */
test.describe("Settings AI tool results", () => {
  test("Demo Co sandbox run shows portal verify href in tool payloads", async ({
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

    const tools = page.getByTestId("ai-agent-tool-results");
    await expect(tools).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ai-agent-tool-portal.invite")).toContainText(
      /ok/i,
    );
    await expect(
      page.getByTestId("ai-agent-tool-creative.sendToPortal"),
    ).toContainText(/ok/i);

    const payloads = page.getByTestId("ai-agent-tool-result-data");
    await expect
      .poll(async () => payloads.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect(payloads.first()).toBeVisible();
    await expect(tools).toContainText(/\/portal\/login\/verify\?token=/);
  });
});
