import { expect, test } from "@playwright/test";

/**
 * Chat Demo Co funnel_act starter closed loop (mock-safe).
 * Dedicated file so chat→funnel agents-on-command stays first-class
 * outside funnel-demo.
 */
test.describe("Chat funnel_act starter UI", () => {
  test("Demo Co sandbox runs funnel_act via starter", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const sandbox = page.getByTestId("chat-sandbox-client");
    await expect(sandbox).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => sandbox.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);

    // Org scope hides the funnel starter (requires client sandbox).
    await sandbox.selectOption({ label: "Staff / org scope" });
    await expect(page.getByTestId("chat-starter-funnel")).toHaveCount(0);

    await sandbox.selectOption({ label: "Demo Co LLC" });
    await page.getByTestId("chat-new").click();
    await expect(page.getByTestId("chat-starter-funnel")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("chat-starter-funnel").click();

    const work = page.getByTestId("chat-work-steps");
    await expect(work).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("chat-tool-funnel_act")).toBeVisible();
    const observation = page.getByTestId("chat-tool-observation");
    await expect(observation).toContainText(
      /tasks\.create|creative\.sendToPortal/i,
    );
    await expect(observation).toContainText(/\/portal\/login\/verify\?token=/);
    // Funnel tool payloads expose portal magic links as clickable next chips.
    const funnel = page.getByTestId("chat-tool-funnel_act");
    await expect(funnel.getByTestId("chat-tool-next")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      funnel
        .getByTestId("chat-next-portal")
        .or(funnel.getByTestId("chat-next-onboarding"))
        .or(funnel.getByTestId("chat-next-creative")),
    ).toBeVisible();
    await expect(page.getByTestId("chat-assistant-message")).toContainText(
      /funnel|portal/i,
    );
  });
});
