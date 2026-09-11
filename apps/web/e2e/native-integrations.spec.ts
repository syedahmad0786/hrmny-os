import { expect, test } from "@playwright/test";

test("direct integrations access requires native identity even for OS staff", async ({
  page,
}) => {
  page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
  const response = await page.goto("/assistant/integrations", {
    waitUntil: "domcontentloaded",
  });

  expect(response?.headers()["content-security-policy"]).toBe(
    "frame-ancestors 'self' https://hrmny-portal.fly.dev",
  );
  await expect(
    page.getByRole("heading", { name: "Integrations" }),
  ).toBeVisible();
  await expect(page.getByText("Open Integrations from the hrmny AI Assistant.")).toBeVisible();
  await expect(page.getByTestId("connections-app-grid")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Primary" }),
  ).toHaveCount(0);
});

test("session popup rejects a direct visit without its initiating window", async ({ page }) => {
  await page.goto("/assistant/integrations/session");
  await expect(page.getByText("This secure session window was not opened by Integrations.")).toBeVisible();
  await expect(page.getByTestId("connections-app-grid")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});
