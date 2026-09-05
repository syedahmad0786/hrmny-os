import { expect, test } from "@playwright/test";

test("Sales opens on one synchronized operating dashboard", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
  await page.goto("/crm/dashboard", { waitUntil: "commit" });

  await expect(
    page.getByRole("heading", { name: "Sales workspace" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("sales-work-queue")).toBeVisible();
  await page.getByRole("button", { name: "Team work" }).click();
  await expect(page.getByRole("button", { name: "Team work" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByText("Deal activity and team workload", { exact: true })
    .click();
  await expect(page.getByTestId("sales-action-groups")).toContainText(
    "Waiting on me",
  );
  await expect(page.getByTestId("sales-action-groups")).toContainText(
    "Stalled",
  );
  await expect(page.getByTestId("sales-action-groups")).toContainText(
    "Moving this week",
  );
  await expect(page.getByTestId("sales-action-groups")).toContainText(
    "Closing",
  );
  await page.getByText("All sales queues", { exact: true }).click();
  await expect(page.getByTestId("sales-dashboard-queue")).toContainText(
    "Follow-ups due",
  );
  await expect(page.getByTestId("sales-dashboard-queue")).toContainText(
    "Company research waiting",
  );
  await expect(
    page.getByTestId("sales-dashboard-outreach-pulse"),
  ).toContainText("Reply rate");
  await expect(
    page.getByRole("link", { name: "Find new clients" }),
  ).toHaveAttribute("href", "/crm/hunt");
  await expect(
    page.getByRole("navigation", { name: "Sales sections" }).getByRole("link", {
      name: "Dashboard",
    }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.desk-nav-btn[href="/crm/dashboard"]')).toHaveText(
    /Sales/,
  );
});

test("Sales queues and setup keep the selected job in focus on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/crm/outreach?view=followups", { waitUntil: "commit" });
  await expect(page.getByTestId("outreach-due-queue")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".outreach-review-panels")).toBeHidden();
  await page.getByRole("link", { name: "Review drafts", exact: true }).click();
  await expect(page.locator(".outreach-drafts-panel")).toBeVisible();
  await expect(page.locator(".outreach-approved-panel")).toBeHidden();
  await page.getByRole("link", { name: "Ready to send", exact: true }).click();
  await expect(page.locator(".outreach-approved-panel")).toBeVisible();
  await expect(page.locator(".outreach-drafts-panel")).toBeHidden();
  await page.goto("/settings/connections?view=sales", { waitUntil: "commit" });
  await expect(page.getByTestId("conn-card-apollo")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("conn-card-google_workspace")).toBeVisible();
  await expect(page.getByTestId("conn-card-xero")).toHaveCount(0);
  await page
    .getByRole("button", { name: "All business tools", exact: true })
    .click();
  await expect(page.getByTestId("conn-card-xero")).toBeVisible();
  await page.goto("/crm/dashboard", { waitUntil: "commit" });
  await expect(page.getByTestId("sales-work-queue")).toBeVisible({
    timeout: 60_000,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/sales-workspace-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/sales-workspace-desktop.png",
    fullPage: true,
  });
});
