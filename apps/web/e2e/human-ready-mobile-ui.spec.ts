import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectMobileReady(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 30_000 });
  expect(
    await target.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}

async function expectMobileCheckboxLabel(page: Page) {
  const checkbox = page.getByRole("checkbox", { name: /Show .*test/i });
  await expect(checkbox).toBeVisible({ timeout: 30_000 });
  expect(
    await checkbox.evaluate(
      (element) =>
        element.closest("label")?.getBoundingClientRect().height ?? 0,
    ),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}

test("primary CRM actions stay usable on a phone", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
  await expectMobileReady(
    page,
    page.getByRole("link", { name: "Manage Apollo" }),
  );

  await page.goto("/crm", { waitUntil: "domcontentloaded" });
  await expectMobileReady(
    page,
    page.locator('.crm-subnav a[href="/crm/contacts"]'),
  );
  await expectMobileReady(
    page,
    page.locator('select[aria-label^="Move "]').first(),
  );

  for (const route of ["/clients", "/delivery"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expectMobileCheckboxLabel(page);
  }

  await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
  await page.getByText("Connection diagnostics", { exact: true }).click();
  await expectMobileReady(
    page,
    page.getByRole("link", { name: "Automation settings" }),
  );
  await expect(page.getByTestId("operating-surfaces")).toContainText(
    "Google Chat → HRMNY",
  );
  await expect(page.getByTestId("operating-surfaces")).toContainText(
    "QM + Fly Sprites",
  );
});
