import { expect, test } from "@playwright/test";

/**
 * Traffic DoR fill≤2 → lock → spawn creative task (mock-safe).
 * Dedicated file so creative-spawn stays first-class outside funnel-demo.
 */
test.describe("Traffic DoR → creative spawn UI", () => {
  test("Fill≤2 & lock spawns creative task and opens Creative", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "traffic" });
    await page.goto("/traffic", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Traffic · Definition of Ready/i }),
    ).toBeVisible({ timeout: 60_000 });

    const briefId = page.getByTestId("traffic-brief-id");
    await expect(briefId).toBeVisible();
    await expect
      .poll(async () => briefId.textContent(), { timeout: 30_000 })
      .toMatch(/d1000000/i);

    const missing = page.getByTestId("traffic-dor-missing");
    await expect(missing).toBeVisible();
    await expect
      .poll(async () => missing.textContent(), { timeout: 30_000 })
      .toMatch(/Missing:\s*[3-9]/);

    await page.getByTestId("traffic-fill-lock").click();

    const status = page.getByTestId("traffic-lock-status");
    await expect(status).toBeVisible({ timeout: 60_000 });
    await expect(status).toContainText(/Locked → taskStatus=brief_ready/i);

    const spawn = page.getByTestId("traffic-spawn-result");
    await expect(spawn).toBeVisible();
    await expect(spawn).toContainText(/Spawned creative task/i);

    const link = page.getByTestId("traffic-creative-task-link");
    await expect(link).toHaveAttribute("href", /\/creative\?taskId=/);
    await link.click();
    await expect(page).toHaveURL(/\/creative\?taskId=/);
    await expect(
      page.getByRole("heading", { name: /^Creative$/i }),
    ).toBeVisible({ timeout: 60_000 });
  });
});
