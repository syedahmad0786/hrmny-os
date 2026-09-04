import { expect, type Page } from "@playwright/test";

export async function advanceDealOnce(page: Page) {
  const advance = page.getByTestId("deal-advance");
  await expect(advance).toBeVisible({ timeout: 15_000 });
  const before = await advance.textContent();
  await advance.click();
  await expect
    .poll(
      async () =>
        !(await advance.isVisible()) ||
        (await advance.textContent()) !== before,
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function seedClientNeeds(page: Page) {
  const save = page.getByTestId("deal-needs-save");
  await expect(save).toBeVisible({ timeout: 60_000 });
  const values = [
    ["deal-need-objective", "Launch the approved client campaign"],
    ["deal-need-deliverables", "Campaign strategy and production assets"],
    ["deal-need-timing", "Launch this quarter"],
    ["deal-need-decision-maker", "Client decision maker"],
  ] as const;
  for (const [testId, value] of values) {
    const input = page.getByTestId(testId);
    if (!(await input.inputValue())) await input.fill(value);
  }
  await save.click();
  await expect(page.getByRole("status")).toContainText(
    "Client needs snapshot saved",
  );
}

async function seedNextAction(page: Page) {
  const save = page.getByTestId("deal-next-action-save");
  await expect(save).toBeVisible({ timeout: 60_000 });
  const title = page.getByTestId("deal-next-action-title");
  const dueDate = page.getByTestId("deal-next-action-date");
  if ((await title.inputValue()) && (await dueDate.inputValue())) return;
  await title.fill("Synthetic handover key date");
  await dueDate.fill("2099-12-31");
  await save.click();
  await expect(page.getByRole("status")).toContainText(
    /Next action (created|updated)/,
  );
}

async function seedHandoverEvidence(page: Page) {
  const dealUrl = page.url();
  const dealId = /\/crm\/deals\/([^/?#]+)/.exec(dealUrl)?.[1];
  if (!dealId) return;
  await page.goto(`/crm/handover?dealId=${dealId}`, {
    waitUntil: "commit",
  });
  const brand = page.getByTestId("handover-check-brand-assets");
  if ((await brand.getAttribute("data-ready")) !== "true") {
    await page
      .getByTestId("handover-brand-input")
      .fill("Synthetic test brand folder received");
    await page.getByRole("button", { name: "Save brand evidence" }).click();
    await expect(brand).toHaveAttribute("data-ready", "true");
  }
  const billing = page.getByTestId("handover-check-billing-details");
  if ((await billing.getAttribute("data-ready")) !== "true") {
    await page
      .getByTestId("handover-billing-input")
      .fill("Synthetic test TRN confirmed");
    await page.getByRole("button", { name: "Save billing evidence" }).click();
    await expect(billing).toHaveAttribute("data-ready", "true");
  }
  await page.goto(dealUrl, { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 60_000,
  });
}

export async function advanceDealToClose(
  page: Page,
  options: { seedHandoverEvidence?: boolean } = {},
) {
  await seedClientNeeds(page);
  await seedNextAction(page);
  const ready = page
    .getByTestId("deal-mark-won")
    .or(page.getByTestId("deal-handover"))
    .or(page.getByTestId("deal-handover-next"));
  const advance = page.getByTestId("deal-advance");
  for (let i = 0; i < 8; i++) {
    await expect(ready.or(advance)).toBeVisible({ timeout: 60_000 });
    if (await ready.isVisible()) {
      if (options.seedHandoverEvidence !== false) {
        await seedHandoverEvidence(page);
      }
      return;
    }
    await advanceDealOnce(page);
  }
  await expect(ready).toBeVisible({ timeout: 5_000 });
  if (options.seedHandoverEvidence !== false) {
    await seedHandoverEvidence(page);
  }
}
