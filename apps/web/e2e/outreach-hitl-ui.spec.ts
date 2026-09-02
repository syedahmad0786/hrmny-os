import { expect, test } from "@playwright/test";

/**
 * Outreach HITL: Create draft → Approve draft via UI (mock-safe).
 * Does not click Send via Gmail (needs live Gmail/Composio).
 */
test.describe("Outreach HITL UI", () => {
  test("Create draft then Approve draft without sending", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/outreach", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Outreach$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByText("Sending setup", { exact: true }).click();

    await expect(page.getByTestId("outreach-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("outreach-ready-gw")).toBeVisible();

    const deal = page.getByTestId("outreach-draft-deal");
    await expect(deal).toBeVisible();
    await expect
      .poll(async () => deal.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);

    // Prefer Demo Co / JW seed deal by label substring.
    const options = deal.locator("option");
    const count = await options.count();
    let selected = false;
    for (let i = 0; i < count; i++) {
      const label = (await options.nth(i).textContent()) ?? "";
      if (/JW Marriott|Demo Co/i.test(label)) {
        await deal.selectOption({ index: i });
        selected = true;
        break;
      }
    }
    if (!selected) {
      await deal.selectOption({ index: 1 });
    }

    const subject = `E2E HITL draft ${Date.now()}`;
    await page.getByTestId("outreach-draft-subject").fill(subject);
    await page
      .getByTestId("outreach-draft-body")
      .fill("E2E body — approve only, do not send.");
    await page.getByTestId("outreach-draft-create").click();

    const draftRow = page
      .locator("[data-outreach-state='draft']")
      .filter({ hasText: subject });
    await expect(draftRow).toBeVisible({ timeout: 30_000 });

    await draftRow.getByTestId("outreach-approve").click();

    const approvedRow = page
      .locator("[data-outreach-state='approved']")
      .filter({ hasText: subject });
    await expect(approvedRow).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .locator("[data-outreach-state='draft']")
        .filter({ hasText: subject }),
    ).toHaveCount(0);

    // Explicitly never click Send via Gmail in this mock-safe path.
    await expect(
      approvedRow.getByRole("button", { name: /Send via Gmail/i }),
    ).toBeVisible();
  });
});
