import { expect, test } from "@playwright/test";

/**
 * Traffic DoR fill≤2 → lock → spawn creative task (mock-safe).
 * Dedicated file so creative-spawn stays first-class outside funnel-demo.
 *
 * Runs alphabetically AFTER funnel-demo (which may already lock the seed
 * brief). Reset M4 first so the brief is unlocked again — safe here because
 * portal/Month-1/calendar e2es that share M4 seed finish earlier in the suite.
 */
test.describe("Traffic DoR → creative spawn UI", () => {
  test("Fill≤2 & lock spawns creative task and opens Creative", async ({
    page,
    request,
  }) => {
    const reset = await request.post("/api/trpc/m4.reset", {
      headers: {
        "x-dev-role": "traffic",
        "content-type": "application/json",
      },
      data: { json: null },
    });
    const resetText = await reset.text();
    expect(reset.ok(), resetText).toBeTruthy();
    expect(resetText).not.toMatch(/"error"/);

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
    await expect(missing).not.toContainText(/locked/i);

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
