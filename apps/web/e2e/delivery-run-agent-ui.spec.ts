import { expect, test } from "@playwright/test";

/** Demo Co creative task (seeded at qc). */
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";

/**
 * Delivery board: Run agent on a client-scoped task (mock-safe).
 * Dedicated file so agents-on-command stays proven outside funnel-demo.
 */
test.describe("Delivery Run agent UI", () => {
  test("Delivery coach Run agent returns non-empty output", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("delivery-ready-banner")).toBeVisible({
      timeout: 30_000,
    });

    const taskSelect = page.getByTestId("delivery-task-select");
    await expect
      .poll(async () => taskSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);

    // Prefer Demo Co creative task when listed.
    const taskOptions = taskSelect.locator("option");
    const taskCount = await taskOptions.count();
    let pickedTask = false;
    for (let i = 0; i < taskCount; i++) {
      const value = (await taskOptions.nth(i).getAttribute("value")) ?? "";
      if (value === DEMO_CREATIVE_TASK_ID) {
        await taskSelect.selectOption(DEMO_CREATIVE_TASK_ID);
        pickedTask = true;
        break;
      }
    }
    if (!pickedTask) {
      await taskSelect.selectOption({ index: 1 });
    }

    const agentSelect = page.getByTestId("delivery-agent-select");
    await expect
      .poll(async () => agentSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);

    const coach = agentSelect.locator("option").filter({
      hasText: /Delivery coach/i,
    });
    if ((await coach.count()) > 0) {
      const value = await coach.first().getAttribute("value");
      expect(value).toBeTruthy();
      await agentSelect.selectOption(value!);
    } else {
      await agentSelect.selectOption({ index: 1 });
    }

    await page
      .getByTestId("delivery-agent-prompt")
      .fill("E2E dedicated: next delivery step for this client task?");
    const run = page.getByTestId("delivery-run-agent");
    await expect(run).toBeEnabled();
    await expect(page.getByTestId("delivery-agent-sandbox-hint")).toBeVisible();
    await expect(page.getByTestId("delivery-sandbox-client")).not.toHaveText("");
    await expect(page.getByTestId("delivery-agent-allowlist")).toBeVisible();
    await run.click();

    const output = page.getByTestId("delivery-agent-output");
    await expect(output).toBeVisible({ timeout: 60_000 });
    await expect(output).not.toHaveText("");
    await expect(output).toContainText(/\w{8,}/);

    // Delivery coach uses funnel tools — expect at least one tool observation.
    const toolResults = page.getByTestId("delivery-agent-tool-results");
    await expect(toolResults).toBeVisible({ timeout: 15_000 });
  });

  test("Portal onboarding mint opens portal onboarding route", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("delivery-ready-portal")).toBeVisible({
      timeout: 30_000,
    });

    const taskSelect = page.getByTestId("delivery-task-select");
    await expect
      .poll(async () => taskSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);

    const taskOptions = taskSelect.locator("option");
    const taskCount = await taskOptions.count();
    let pickedTask = false;
    for (let i = 0; i < taskCount; i++) {
      const value = (await taskOptions.nth(i).getAttribute("value")) ?? "";
      if (value === DEMO_CREATIVE_TASK_ID) {
        await taskSelect.selectOption(DEMO_CREATIVE_TASK_ID);
        pickedTask = true;
        break;
      }
    }
    if (!pickedTask) {
      await taskSelect.selectOption({ index: 1 });
    }

    const onboarding = page.getByTestId("delivery-client-onboarding");
    await expect(onboarding).toBeEnabled({ timeout: 30_000 });
    await onboarding.click();
    await expect(page).toHaveURL(/\/portal\/onboarding/, { timeout: 60_000 });
  });
});
