import { expect, test } from "@playwright/test";

const ROLE_JOURNEYS = [
  {
    role: "am",
    label: "Account management",
    primaryArea: "Sales",
    canPreviewClient: false,
    canViewAudit: false,
  },
  {
    role: "finance",
    label: "Finance",
    primaryArea: "Finance",
    canPreviewClient: false,
    canViewAudit: true,
  },
  {
    role: "hr",
    label: "People operations",
    primaryArea: "People",
    canPreviewClient: false,
    canViewAudit: true,
  },
  {
    role: "traffic",
    label: "Traffic",
    primaryArea: "Delivery",
    canPreviewClient: false,
    canViewAudit: true,
  },
  {
    role: "creative_director",
    label: "Creative",
    primaryArea: "Delivery",
    canPreviewClient: false,
    canViewAudit: true,
  },
  {
    role: "director",
    label: "Director",
    primaryArea: "Delivery",
    canPreviewClient: true,
    canViewAudit: true,
  },
] as const;

for (const journey of ROLE_JOURNEYS) {
  test(`${journey.role} lands on scoped owned work`, async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-dev-role": journey.role });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("role-home-label")).toContainText(
      journey.label,
    );
    await expect(page.getByTestId("role-primary-action")).toHaveAttribute(
      "href",
      "/work/my-tasks",
    );
    await expect(page.getByTestId("next-owned-work")).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: journey.primaryArea, exact: true }),
    ).toBeVisible();

    const clientPreview = page.getByRole("link", { name: "Client view" });
    await expect(clientPreview).toHaveCount(journey.canPreviewClient ? 1 : 0);
    const audit = page.getByRole("link", { name: "Open audit activity" });
    await expect(audit).toHaveCount(journey.canViewAudit ? 1 : 0);
  });
}

test("role navigation exposes focused areas without a More drawer", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const nav = page.getByRole("navigation", { name: "Primary" });

  await expect(nav.getByRole("link", { name: "Sales" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "My work" })).toBeVisible();
  await expect(page.locator("details.desk-nav-more")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Connections", exact: true }),
  ).toBeVisible();
});

test("role home remains usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setExtraHTTPHeaders({ "x-dev-role": "hr" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("role-primary-action")).toBeVisible();
  await expect(page.getByTestId("next-owned-work")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "People" }),
  ).toBeVisible();
  await expect(page.locator("details.desk-nav-more")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
