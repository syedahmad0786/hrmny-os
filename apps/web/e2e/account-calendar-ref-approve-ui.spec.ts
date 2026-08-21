import { expect, test } from "@playwright/test";

const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";

/**
 * Account calendar Ref-approve via UI (mock-safe).
 * Demo Co M4 calendar seeds at ref_pending.
 */
test.describe("Account calendar Ref-approve UI", () => {
  test("Ref-approve calendar advances to ref_approved", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(`/account?clientId=${DEMO_CLIENT_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Account|Month|Calendar/i }).first(),
    ).toBeVisible({ timeout: 60_000 });

    const meta = page.getByTestId("account-calendar-meta");
    await expect(meta).toBeVisible({ timeout: 30_000 });

    const state = (await meta.getAttribute("data-calendar-state")) ?? "";
    if (/ref_approved/i.test(state)) {
      await expect(meta).toHaveAttribute("data-calendar-state", /ref_approved/i);
      return;
    }

    await expect(meta).toHaveAttribute("data-calendar-state", /ref_pending/i);
    await page.getByTestId("account-ref-approve").click();
    await expect(meta).toHaveAttribute("data-calendar-state", /ref_approved/i, {
      timeout: 30_000,
    });
  });
});
