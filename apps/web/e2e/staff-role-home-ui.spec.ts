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

test("More is keyboard-operable and identifies a hidden active area", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const details = page.locator("details.desk-nav-more");
  const toggle = page.getByTestId("staff-more-toggle");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect(details.getByRole("link", { name: "Reports" })).toBeVisible();

  await page.goto("/dashboards", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("staff-more-toggle")).toHaveClass(/active/);
  await expect(page.locator("details.desk-nav-more")).toHaveAttribute(
    "open",
    "",
  );
});

test("role home remains usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setExtraHTTPHeaders({ "x-dev-role": "hr" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("role-primary-action")).toBeVisible();
  await expect(page.getByTestId("next-owned-work")).toBeVisible();
  await page.getByTestId("staff-more-toggle").click();
  await expect(
    page.locator("details.desk-nav-more").getByRole("link", { name: "Sales" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
