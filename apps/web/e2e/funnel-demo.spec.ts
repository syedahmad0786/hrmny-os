import { test, expect } from "@playwright/test";

/**
 * Demo funnel — prospecting → sales → onboarding → creative → portal.
 * Uses x-dev-role (requires AUTH_MODE=dev + ALLOW_DEV_AUTH in CI prod server).
 */
test.describe("Demo funnel", () => {
  test.setTimeout(180_000);

  test("staff path: CRM → clients → creative → delivery → AI", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });

    await page.goto("/crm", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/CRM|deal|pipeline/i);

    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/hunt|apollo|closed loop/i);

    await page.goto("/crm/deals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await page.goto("/crm/inbound", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/inbound|lead|prospect/i);

    await page.goto("/crm/outreach", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/outreach|draft|queue/i);

    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/client/i);

    await page.goto("/creative", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^Creative$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pass QC/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate image/i })).toBeVisible();

    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible();
    await expect(page.locator("body")).toContainText(/Run agent on task/i);

    await page.goto("/settings/ai", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/AI|agent/i);

    await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/connection|composio|apollo/i);

    await page.goto("/settings/automations", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Automations/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Run n8n smoke/i })).toBeVisible();
  });

  test("portal path: client workspace loads for portal_a", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "portal_a" });

    await page.goto("/portal", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/workspace|brief|approval/i);
    await expect(page.url()).not.toContain("/portal/login");

    await page.goto("/portal/approvals", { waitUntil: "domcontentloaded" });
    await expect(page.url()).not.toContain("/portal/login");

    await page.goto("/portal/onboarding", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Onboarding/i })).toBeVisible();
  });

  test("deal detail exposes won + handover controls", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/deals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    const firstDeal = page.locator('a[href^="/crm/deals/"]').first();
    if (await firstDeal.count()) {
      await firstDeal.click();
      await expect(page.locator("body")).toContainText(/BUAF|Advance|Mark won|Handover|Commercial/i);
    }
  });

  test("outreach and approvals honor ?id= deep links", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/outreach?id=demo-focus", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/outreach|draft|queue/i);

    await page.goto("/approvals?id=demo-focus", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("body")).toContainText(/approval|inbox|HITL/i);
  });

  test("client onboarding shows continue OS links", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    const firstClient = page.locator('a[href^="/clients/"]').first();
    if (await firstClient.count()) {
      await firstClient.click();
      await expect(
        page.getByRole("navigation", { name: "Continue OS after handover" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("link", { name: /Account calendar/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Creative/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Finance/i })).toBeVisible();
    }
  });

  test("finance honors ?invoiceId= deep link", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/finance?invoiceId=demo-inv", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/finance|invoice|xero/i);
  });
});
