import { expect, test, type Page } from "@playwright/test";

/**
 * Explicit synthetic acceptance path (no live Apollo key):
 * synthetic Apollo fixture → BUAF + email verify → advance to price_cost →
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

/** Apollo prospect → deal UI → Mark won → handover next links. */
async function ensureApolloDealHandoverNext(page: Page, query: string) {
  page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
  await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByTestId("hunt-test-tools").click();
  await page.getByTestId("hunt-synthetic-company").fill(query);
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
}

test.describe("Hunt Apollo → won → handover continuity", () => {
  test.setTimeout(180_000);

  test("Prospect → advance → Mark won → Handover → Creative", async ({
    page,
  }) => {
    const query = `E2E Apollo Won ${Date.now()}`;
    await ensureApolloDealHandoverNext(page, query);

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

  test("Apollo prospect handover portal and onboarding magic links", async ({
    page,
  }) => {
    const query = `E2E Apollo Portal ${Date.now()}`;
    await ensureApolloDealHandoverNext(page, query);

    const portal = page.getByTestId("deal-handover-portal");
    await expect(portal).toBeVisible();
    await expect(portal).toHaveAttribute("href", /\/portal\/login\/verify/);
    const onboardingInvite = page.getByTestId(
      "deal-handover-onboarding-invite",
    );
    await expect(onboardingInvite).toBeVisible();
    await expect(onboardingInvite).toHaveAttribute(
      "href",
      /\/portal\/login\/verify/,
    );
    const portalHref = await portal.getAttribute("href");
    const onboardingHref = await onboardingInvite.getAttribute("href");
    expect(portalHref).toBeTruthy();
    expect(onboardingHref).toBeTruthy();
    expect(portalHref).not.toBe(onboardingHref);

    await portal.click();
    await expect(page).toHaveURL(/\/portal\/login\/verify/, {
      timeout: 60_000,
    });
    await expect(page).toHaveURL(/token=/);
    await expect(
      page.getByRole("heading", { name: /^Approvals$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/portal\/approvals/);

    await page.goto(onboardingHref!, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Onboarding$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/portal\/onboarding/);
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

    await page.getByTestId("hunt-test-tools").click();
    await page.getByTestId("hunt-synthetic-company").fill(query);
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

  test("Closed loop status panel finance outreach portal onboarding links", async ({
    page,
  }) => {
    const query = `E2E Apollo Status ${Date.now()}`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId("hunt-test-tools").click();
    await page.getByTestId("hunt-synthetic-company").fill(query);
    await page.getByTestId("hunt-closed-loop-apollo").click();

    const status = page.getByTestId("hunt-closed-loop-status");
    await expect(status).toContainText(/Closed loop ready/i, {
      timeout: 90_000,
    });

    const statusFinance = page.getByTestId("hunt-status-finance");
    const statusOutreach = page.getByTestId("hunt-status-outreach");
    const statusPortal = page.getByTestId("hunt-status-portal");
    const statusOnboarding = page.getByTestId("hunt-status-onboarding");
    await expect(statusFinance).toBeVisible();
    await expect(statusOutreach).toBeVisible();
    await expect(statusPortal).toBeVisible();
    await expect(statusOnboarding).toBeVisible();
    await expect(statusFinance).toHaveAttribute("href", /clientId=/);
    await expect(statusOutreach).toHaveAttribute("href", /\/crm\/outreach/);
    await expect(statusPortal).toHaveAttribute(
      "href",
      /\/portal\/login\/verify/,
    );
    await expect(statusOnboarding).toHaveAttribute(
      "href",
      /\/portal\/login\/verify/,
    );

    const nextFinance = page.getByTestId("hunt-next-finance");
    const nextOutreach = page.getByTestId("hunt-next-outreach");
    const nextPortal = page.getByTestId("hunt-next-portal");
    const nextOnboarding = page.getByTestId("hunt-next-onboarding");
    await expect(nextFinance).toBeVisible();
    await expect(nextOutreach).toBeVisible();
    await expect(nextPortal).toBeVisible();
    await expect(nextOnboarding).toBeVisible();

    const portalHref = await statusPortal.getAttribute("href");
    const onboardingHref = await statusOnboarding.getAttribute("href");
    const financeHref = await nextFinance.getAttribute("href");
    const outreachHref = await nextOutreach.getAttribute("href");
    expect(portalHref).toBeTruthy();
    expect(onboardingHref).toBeTruthy();
    expect(financeHref).toBeTruthy();
    expect(outreachHref).toBeTruthy();
    expect(portalHref).not.toBe(onboardingHref);

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(financeHref!, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/clientId=/);
    await expect(page.locator("body")).toContainText(/finance|invoice/i);

    await page.goto(outreachHref!, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/crm\/outreach/);
    await expect(
      page.getByRole("heading", { name: /Outreach drafts/i }),
    ).toBeVisible({ timeout: 60_000 });

    await page.goto(portalHref!, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/portal\/login\/verify/, {
      timeout: 60_000,
    });
    await expect(
      page.getByRole("heading", { name: /^Approvals$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/portal\/approvals/);

    await page.goto(onboardingHref!, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Onboarding$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/portal\/onboarding/);
  });
});
