import { expect, test } from "@playwright/test";

/** Demo Co seed ids (memory + SQL). */
const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";

/**
 * Delivery → Traffic clientId closed loop (mock-safe).
 * Selects a Demo Co task, follows delivery-traffic-link, and asserts
 * traffic-active-client. Also proves ?taskId= hydrate on Delivery.
 */
test.describe("Delivery → Traffic clientId UI", () => {
  test("delivery-traffic-link passes clientId to traffic-active-client", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("checkbox", { name: /Show \d+ test item/i }).check();
    await page
      .getByText("Delivery setup and automation", { exact: true })
      .click();

    const taskSelect = page.getByTestId("delivery-task-select");
    await expect
      .poll(async () => taskSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);

    const options = taskSelect.locator("option");
    let picked = false;
    for (let i = 0; i < (await options.count()); i++) {
      const value = (await options.nth(i).getAttribute("value")) ?? "";
      if (value === DEMO_CREATIVE_TASK_ID) {
        await taskSelect.selectOption(DEMO_CREATIVE_TASK_ID);
        picked = true;
        break;
      }
    }
    if (!picked) await taskSelect.selectOption({ index: 1 });

    const link = page.getByTestId("delivery-traffic-link");
    await expect(link).toHaveAttribute("href", /clientId=/);
    const href = (await link.getAttribute("href")) ?? "";
    const clientId = new URL(href, "http://localhost").searchParams.get(
      "clientId",
    );
    expect(clientId).toBeTruthy();

    await link.click();
    await expect(page).toHaveURL(new RegExp(`clientId=${clientId}`));
    const active = page.getByTestId("traffic-active-client");
    await expect(active).toBeVisible({ timeout: 30_000 });
    await expect(active).toContainText(clientId!.slice(0, 8));
  });

  test("?taskId= hydrates delivery task select", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(
      `/delivery?clientId=${DEMO_CLIENT_ID}&taskId=${DEMO_CREATIVE_TASK_ID}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });
    await page
      .getByText("Delivery setup and automation", { exact: true })
      .click();
    await expect(page.getByTestId("delivery-task-select")).toHaveValue(
      DEMO_CREATIVE_TASK_ID,
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("delivery-sandbox-client")).not.toHaveText(
      /^\s*$/,
    );
    await expect(page.getByTestId("delivery-traffic-link")).toHaveAttribute(
      "href",
      new RegExp(`clientId=${DEMO_CLIENT_ID}`),
    );
  });
});
