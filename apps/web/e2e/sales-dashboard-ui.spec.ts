import { expect, test } from "@playwright/test";

test("Sales opens on one synchronized operating dashboard", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
  await page.goto("/crm/dashboard", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "Sales command center" }),
  ).toBeVisible({ timeout: 60_000 });
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
