import { expect, test } from "@playwright/test";

/** Demo Co seeds — closed-loop clients must not pin to these. */
const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";

/**
 * After Apollo closed loop, Delivery ?clientId=&taskId= must bind the won
 * client's sandbox (not Demo Co) and Run agent returns output on that scope.
 */
test.describe("Delivery won-client agent sandbox", () => {
  test.setTimeout(180_000);

  test("Closed loop client task runs Delivery coach in client sandbox", async ({
    page,
  }) => {
    const query = `E2E Delivery Won ${Date.now()}`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId("hunt-apollo-query").fill(query);
    await page.getByTestId("hunt-test-tools").click();
    await page.getByTestId("hunt-closed-loop-apollo").click();
    await expect(page.getByTestId("hunt-closed-loop-status")).toContainText(
      /Closed loop ready/i,
      { timeout: 90_000 },
    );

    const creativeLink = page.getByTestId("hunt-next-creative");
    await expect(creativeLink).toBeVisible();
    const creativeHref = await creativeLink.getAttribute("href");
    expect(creativeHref).toBeTruthy();
    const deeplink = new URL(creativeHref!, "http://localhost");
    const clientId = deeplink.searchParams.get("clientId");
    const taskId = deeplink.searchParams.get("taskId");
    expect(clientId).toBeTruthy();
    expect(taskId).toBeTruthy();
    expect(clientId).not.toBe(DEMO_CLIENT_ID);
    expect(taskId).not.toBe(DEMO_CREATIVE_TASK_ID);

    await page.goto(`/delivery?clientId=${clientId}&taskId=${taskId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("delivery-task-select")).toHaveValue(
      taskId!,
      {
        timeout: 60_000,
      },
    );

    const sandbox = page.getByTestId("delivery-sandbox-client");
    await expect(sandbox).toBeVisible();
    await expect(sandbox).not.toHaveText(/^\s*$/);
    await expect(sandbox).not.toContainText(/Demo Co/i);

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
      await agentSelect.selectOption(
        await coach.first().getAttribute("value")!,
      );
    } else {
      await agentSelect.selectOption({ index: 1 });
    }

    await page
      .getByTestId("delivery-agent-prompt")
      .fill("E2E won-client: one next delivery step for this sandbox?");
    await page.getByTestId("delivery-run-agent").click();

    const output = page.getByTestId("delivery-agent-output");
    await expect(output).toBeVisible({ timeout: 60_000 });
    await expect(output).not.toHaveText("");
    await expect(page.getByTestId("delivery-agent-tool-results")).toBeVisible({
      timeout: 15_000,
    });
  });
});
