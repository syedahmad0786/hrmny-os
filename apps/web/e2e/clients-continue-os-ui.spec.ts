import { expect, test } from "@playwright/test";

/** Seed JW Marriott deal already at propose (memory + SQL). */
const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";
/** Demo Co creative seed — Continue OS must not pin won clients to this. */
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";

/**
 * After deal won → handover, Clients Continue-OS CTAs must pin the won
 * client's taskId/calendarId/invoiceId/outreach/approvals ids (not Demo Co
 * seeds or bare queues). Creative with only ?clientId= must resolve the same
 * won-client task.
 */
test.describe("Clients Continue OS after handover", () => {
  test("Continue OS CTAs pin won-client Creative/Account/Finance/Outreach", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto(`/crm/deals/${PROPOSE_DEAL_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });

    const advance = page.getByTestId("deal-advance");
    if (await advance.isVisible()) {
      await advance.click();
      await expect(
        page
          .getByTestId("deal-mark-won")
          .or(page.getByTestId("deal-handover"))
          .or(page.getByTestId("deal-handover-next")),
      ).toBeVisible({ timeout: 30_000 });
    }

    const markWon = page.getByTestId("deal-mark-won");
    if (await markWon.isVisible()) {
      await markWon.click();
      await expect(
        page
          .getByTestId("deal-handover")
          .or(page.getByTestId("deal-handover-next")),
      ).toBeVisible({ timeout: 30_000 });
    }

    const handover = page.getByTestId("deal-handover");
    if (await handover.isVisible()) {
      await handover.click();
    }
    await expect(page.getByTestId("deal-handover-next")).toBeVisible({
      timeout: 30_000,
    });

    const handoverCreative = page.getByTestId("deal-handover-creative");
    await expect(handoverCreative).toHaveAttribute("href", /taskId=/);
    const handoverHref = (await handoverCreative.getAttribute("href")) ?? "";
    const handoverTaskId = new URL(
      handoverHref,
      "http://local",
    ).searchParams.get("taskId");
    expect(handoverTaskId).toBeTruthy();
    expect(handoverTaskId).not.toBe(DEMO_CREATIVE_TASK_ID);

    await page.getByTestId("deal-handover-client").click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}/i);
    await expect(page.getByTestId("client-continue-os")).toBeVisible({
      timeout: 60_000,
    });

    const continueCreative = page.getByTestId("client-continue-creative");
    await expect(continueCreative).toHaveAttribute("href", /taskId=/);
    const continueHref = (await continueCreative.getAttribute("href")) ?? "";
    const continueTaskId = new URL(
      continueHref,
      "http://local",
    ).searchParams.get("taskId");
    expect(continueTaskId).toBe(handoverTaskId);
    expect(continueTaskId).not.toBe(DEMO_CREATIVE_TASK_ID);

    const continueAccount = page.getByTestId("client-continue-account");
    const accountHref = (await continueAccount.getAttribute("href")) ?? "";
    expect(accountHref).toMatch(/clientId=/);
    expect(accountHref).toMatch(/calendarId=/);
    const continueCalendarId = new URL(
      accountHref,
      "http://local",
    ).searchParams.get("calendarId");
    expect(continueCalendarId).toBeTruthy();

    // Finance / Outreach / Approvals must pin won-client seeds (not bare queues).
    const continueFinance = page.getByTestId("client-continue-finance");
    await expect(continueFinance).toHaveAttribute("href", /invoiceId=/);
    const financeHref = (await continueFinance.getAttribute("href")) ?? "";
    const continueInvoiceId = new URL(
      financeHref,
      "http://local",
    ).searchParams.get("invoiceId");
    expect(continueInvoiceId).toBeTruthy();

    const continueOutreach = page.getByTestId("client-continue-outreach");
    await expect(continueOutreach).toHaveAttribute("href", /[?&]id=/);
    const outreachHref = (await continueOutreach.getAttribute("href")) ?? "";
    const continueOutreachId = new URL(
      outreachHref,
      "http://local",
    ).searchParams.get("id");
    expect(continueOutreachId).toBeTruthy();

    const continueApprovals = page.getByTestId("client-continue-approvals");
    await expect(continueApprovals).toHaveAttribute("href", /[?&]id=/);

    await continueCreative.click();
    await expect(page).toHaveURL(new RegExp(`taskId=${continueTaskId}`));
    await expect(page.getByTestId("creative-task-id")).toHaveText(
      continueTaskId!,
      { timeout: 60_000 },
    );

    // clientId-only creative URL must resolve the same won-client task, not Demo Co.
    const clientId = new URL(continueHref, "http://local").searchParams.get(
      "clientId",
    );
    expect(clientId).toBeTruthy();
    await page.goto(`/creative?clientId=${clientId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("creative-task-id")).toHaveText(
      continueTaskId!,
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("creative-task-id")).not.toHaveText(
      DEMO_CREATIVE_TASK_ID,
    );

    await page.goto(accountHref, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/account\?/);
    await expect(page.getByTestId("account-active-calendar")).toHaveText(
      continueCalendarId!,
      { timeout: 60_000 },
    );

    await page.goto(financeHref, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`invoiceId=${continueInvoiceId}`));
    await expect(
      page.locator(`[data-testid="finance-invoice"]#os-invoice-${continueInvoiceId}`),
    ).toBeVisible({ timeout: 60_000 });

    // clientId-only finance URL must resolve the same won-client first invoice.
    await page.goto(`/finance?clientId=${clientId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("finance-active-invoice")).toHaveText(
      continueInvoiceId!,
      { timeout: 60_000 },
    );

    await page.goto(outreachHref, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`[?&]id=${continueOutreachId}`));
    await expect(
      page.getByTestId(`outreach-item-${continueOutreachId}`),
    ).toBeVisible({ timeout: 60_000 });
  });
});
