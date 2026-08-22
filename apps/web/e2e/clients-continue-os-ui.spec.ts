import { expect, test } from "@playwright/test";

/** Seed JW Marriott deal already at propose (memory + SQL). */
const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";
/** Demo Co creative seed — Continue OS must not pin won clients to this. */
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";

/**
 * After deal won → handover, Clients Continue-OS Creative/Account CTAs must
 * pin the won client's taskId/calendarId (not Demo Co seeds). Creative with
 * only ?clientId= must resolve the same won-client task.
 */
test.describe("Clients Continue OS after handover", () => {
  test("Creative + Account CTAs pin won-client ids", async ({ page }) => {
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
      await expect(page.getByTestId("deal-mark-won")).toBeVisible({
        timeout: 30_000,
      });
    }

    await page.getByTestId("deal-mark-won").click();
    await expect(page.getByTestId("deal-handover")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("deal-handover").click();
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
  });
});
