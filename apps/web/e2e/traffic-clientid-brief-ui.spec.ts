import { expect, test } from "@playwright/test";

/** Demo Co seed client (memory + SQL). */
const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";

/**
 * Traffic ?clientId= resolves the client-scoped brief via m4.seedIds (mock-safe).
 * Complements Delivery→Traffic clientId e2e by asserting brief hydration, not
 * only the active-client chip. Brief id may be the demo seed (memory) or a
 * durable UUID when DATABASE_URL is set — either is a successful resolve.
 */
test.describe("Traffic clientId → brief resolution UI", () => {
  test("?clientId= loads traffic-active-client and resolves traffic-brief-id", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(`/traffic?clientId=${DEMO_CLIENT_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Traffic · Definition of Ready/i }),
    ).toBeVisible({ timeout: 60_000 });

    const active = page.getByTestId("traffic-active-client");
    await expect(active).toBeVisible({ timeout: 30_000 });
    await expect(active).toContainText(DEMO_CLIENT_ID.slice(0, 8));

    const briefId = page.getByTestId("traffic-brief-id");
    await expect(briefId).toBeVisible();
    await expect
      .poll(async () => (await briefId.textContent()) ?? "", {
        timeout: 30_000,
      })
      .toMatch(/[0-9a-f-]{36}/i);

    // DoR panel is bound to the resolved brief (not stuck on empty seed).
    await expect(page.getByTestId("traffic-dor-missing")).toBeVisible();
    await expect(page.getByTestId("traffic-fill-lock")).toBeVisible();
  });

  test("Delivery traffic link → Traffic resolves brief for that client", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });

    const taskSelect = page.getByTestId("delivery-task-select");
    await expect
      .poll(async () => taskSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);
    await taskSelect.selectOption({ index: 1 });

    const link = page.getByTestId("delivery-traffic-link");
    await expect(link).toHaveAttribute("href", /clientId=/);
    const href = (await link.getAttribute("href")) ?? "";
    const clientId = new URL(href, "http://localhost").searchParams.get(
      "clientId",
    );
    expect(clientId).toBeTruthy();

    await link.click();
    await expect(page).toHaveURL(new RegExp(`clientId=${clientId}`));
    await expect(page.getByTestId("traffic-active-client")).toContainText(
      clientId!.slice(0, 8),
      { timeout: 30_000 },
    );

    const briefId = page.getByTestId("traffic-brief-id");
    await expect
      .poll(async () => (await briefId.textContent()) ?? "", {
        timeout: 30_000,
      })
      .toMatch(/[0-9a-f-]{36}/i);
  });
});
