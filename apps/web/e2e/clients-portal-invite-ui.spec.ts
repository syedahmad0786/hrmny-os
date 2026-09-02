import { expect, test } from "@playwright/test";
import { DEMO_CLIENT_ID } from "./route-manifest";

/**
 * Clients directory: grant portal access mints magic link (Resend mock in CI).
 */
test.describe("Clients portal invite UI", () => {
  test("grant portal access shows mock delivery note and magic link", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Client directory/i }),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByText("Client setup status", { exact: true }).click();
    await expect(page.getByTestId("clients-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("checkbox", { name: /Show \d+ test client/i }).check();

    await page.getByTestId(`clients-manage-portal-${DEMO_CLIENT_ID}`).click();
    await expect(page.getByTestId("clients-portal-access-panel")).toBeVisible({
      timeout: 30_000,
    });

    const email = `portal-invite-${Date.now()}@example.com`;
    await page
      .getByTestId("clients-portal-invite-name")
      .fill("Portal Invite E2E");
    await page.getByTestId("clients-portal-invite-email").fill(email);
    await page.getByTestId("clients-portal-invite-submit").click();

    const note = page.getByTestId("clients-portal-invite-note");
    await expect(note).toBeVisible({ timeout: 30_000 });
    await expect(note).toContainText(/mock|magic link|Resend/i);

    const link = page.getByTestId("clients-portal-demo-link-href");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", /\/portal\//);
  });
});
