import { expect, test } from "@playwright/test";

test("native integrations is an authenticated contained Connections surface", async ({
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
    page.getByRole("heading", { name: "Connections" }),
  ).toBeVisible();
  await expect(page.getByTestId("connections-app-grid")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }),
  ).toHaveCount(0);
});
