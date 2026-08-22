import { expect, test, type Page } from "@playwright/test";

/**
 * Continuous sales path (mock-safe, no live Apollo key):
 * Hunt Apollo prospect → BUAF + email verify → advance to price_cost →
 * Mark won → Handover pack → Creative.
 *
 * Also covers Hunt "Closed loop via Apollo" next-link continuity.
 */

async function advanceToMarkWon(page: Page) {
  for (let i = 0; i < 8; i++) {
    const markWon = page.getByTestId("deal-mark-won");
    if (await markWon.isVisible()) return;
    const advance = page.getByTestId("deal-advance");
    await expect(advance).toBeVisible({ timeout: 15_000 });
    const before = await advance.textContent();
    await advance.click();
    await expect
      .poll(
        async () => {
          if (await markWon.isVisible()) return "won";
          const after = await advance.textContent();
          return after !== before ? "moved" : "pending";
        },
        { timeout: 20_000 },
      )
      .not.toBe("pending");
  }
  await expect(page.getByTestId("deal-mark-won")).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("Hunt Apollo → won → handover continuity", () => {
  test.setTimeout(180_000);

  test("Prospect → advance → Mark won → Handover → Creative", async ({
    page,
  }) => {
    const query = `E2E Apollo Won ${Date.now()}`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId("hunt-apollo-query").fill(query);
    await page.getByTestId("hunt-apollo-prospect").click();

    const status = page.getByTestId("hunt-closed-loop-status");
    await expect(status).toContainText(/Apollo \(mock/i, { timeout: 30_000 });
    await expect(status).toContainText(/discover deal/i);

    const open = page.getByTestId("hunt-apollo-open-deal");
    await expect(open).toBeVisible();
    await open.click();

    await expect(page).toHaveURL(/\/crm\/deals\/[0-9a-f-]{36}/i, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/discover/i);

    // Satisfy qualify→engage (BUAF Fit + Warm+) and engage→scope (email + voice).
    for (const id of [
      "deal-buaf-budget",
      "deal-buaf-urgency",
      "deal-buaf-access",
      "deal-buaf-fit",
    ]) {
      await page.getByTestId(id).check();
    }
    await page.getByTestId("deal-buaf-temperature").selectOption("warm");
    await page.getByTestId("deal-buaf-save").click();

    // Apollo mock may already mark email verified — only click when enabled.
    const emailVerify = page.getByTestId("deal-email-verify");
    await expect(emailVerify).toBeVisible();
    if (await emailVerify.isEnabled()) {
      await emailVerify.click();
    }
    await expect(emailVerify).toBeDisabled({ timeout: 15_000 });

    await advanceToMarkWon(page);

    await page.getByTestId("deal-mark-won").click();
    await expect(
      page
        .getByTestId("deal-handover")
        .or(page.getByTestId("deal-handover-next")),
    ).toBeVisible({ timeout: 30_000 });

    const next = page.getByTestId("deal-handover-next");
    if (!(await next.isVisible())) {
      await page.getByTestId("deal-handover").click();
    }
    await expect(next).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("deal-handover-client")).toBeVisible();
    const finance = page.getByTestId("deal-handover-finance");
    await expect(finance).toBeVisible();
    await expect(finance).toHaveAttribute("href", /clientId=/);
    const creative = page.getByTestId("deal-handover-creative");
    await expect(creative).toBeVisible();
    await expect(creative).toHaveAttribute("href", /taskId=/);

    await creative.click();
    await expect(page).toHaveURL(/\/creative\?.*taskId=/);
    await expect(page.getByRole("heading", { name: /Creative/i })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("Closed loop via Apollo opens Deal → Client → Creative", async ({
    page,
  }) => {
    const query = `E2E Apollo Loop ${Date.now()}`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId("hunt-apollo-query").fill(query);
    await page.getByTestId("hunt-closed-loop-apollo").click();

    const status = page.getByTestId("hunt-closed-loop-status");
    await expect(status).toContainText(/Closed loop ready/i, {
      timeout: 90_000,
    });
    await expect(status).toContainText(/via Apollo/i);

    const dealLink = page.getByTestId("hunt-next-deal");
    const clientLink = page.getByTestId("hunt-next-client");
    const creativeLink = page.getByTestId("hunt-next-creative");
    await expect(dealLink).toBeVisible();
    await expect(clientLink).toBeVisible();
    await expect(creativeLink).toBeVisible();

    const dealHref = await dealLink.getAttribute("href");
    const clientHref = await clientLink.getAttribute("href");
    const creativeHref = await creativeLink.getAttribute("href");
    expect(dealHref).toMatch(/\/crm\/deals\//);
    expect(clientHref).toMatch(/\/clients\//);
    expect(creativeHref).toMatch(/taskId=/);

    await page.goto(dealHref!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(
      /won|handover|close|price/i,
    );

    await page.goto(clientHref!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });

    await page.goto(creativeHref!, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/creative\?.*taskId=/);
    await expect(page.getByRole("heading", { name: /Creative/i })).toBeVisible({
      timeout: 60_000,
    });
  });
});
