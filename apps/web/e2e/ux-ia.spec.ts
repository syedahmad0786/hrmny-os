import { expect, test } from "@playwright/test";
import path from "node:path";

const artifacts = path.join(process.cwd(), "test-results", "artifacts");

test.describe("UX IA smoke", () => {
  test("Today nav, action queue, CRM hierarchy, theme control", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 30_000,
    });

    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByText("Today")).toBeVisible();
    await expect(primary.getByText("Pipeline")).toBeVisible();
    await expect(primary.getByText("Clients")).toBeVisible();
    await expect(primary.getByText("Work")).toBeVisible();
    await expect(primary.getByText("Money")).toBeVisible();
    await expect(primary.getByText("People")).toBeVisible();
    await expect(primary.getByText("Admin")).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /Your queue today/i }),
    ).toBeVisible();
    await expect(page.getByText("Action queue")).toBeVisible();
    await expect(page.getByLabel("Color theme")).toBeVisible();

    await page.screenshot({
      path: path.join(artifacts, "ux-today-home.png"),
      fullPage: true,
    });

    await page.goto("/crm");
    const crmNav = page.getByRole("navigation", { name: "CRM sections" });
    await expect(crmNav).toBeVisible();
    await expect(crmNav.getByText("Pipeline")).toBeVisible();
    await expect(crmNav.getByText("Directory")).toBeVisible();
    await expect(crmNav.getByText("Engage")).toBeVisible();
    await expect(crmNav.getByText("Sales work")).toBeVisible();
    await expect(crmNav.getByText("Commercial")).toBeVisible();
    // Old 11-tab labels should not appear as top-level CRM tabs.
    await expect(crmNav.getByText("Companies")).toHaveCount(0);
    await expect(crmNav.getByText("Email + calendar")).toHaveCount(0);

    await page.screenshot({
      path: path.join(artifacts, "ux-crm-pipeline.png"),
      fullPage: true,
    });

    await page.goto("/finance");
    await expect(
      page.getByRole("heading", { name: /Invoice intake/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Money sections" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(artifacts, "ux-money-hub.png"),
      fullPage: true,
    });

    // Dark theme applies data attribute.
    await page.getByLabel("Color theme").selectOption("dark");
    await expect
      .poll(async () =>
        page.locator("html").evaluate((el) => el.dataset.workTheme),
      )
      .toBe("dark");
    await page.screenshot({
      path: path.join(artifacts, "ux-today-dark.png"),
      fullPage: true,
    });
  });
});
