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
  if (!(await save.isVisible())) return;
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
  }
  const billing = page.getByTestId("handover-check-billing-details");
  if ((await billing.getAttribute("data-ready")) !== "true") {
    await page
      .getByTestId("handover-billing-input")
      .fill("Synthetic test TRN confirmed");
    await page.getByRole("button", { name: "Save billing evidence" }).click();
  }
  await page.goto(dealUrl, { waitUntil: "commit" });
}

export async function advanceDealToClose(
  page: Page,
  options: { seedHandoverEvidence?: boolean } = {},
) {
  await seedClientNeeds(page);
  const ready = page
    .getByTestId("deal-mark-won")
    .or(page.getByTestId("deal-handover"))
    .or(page.getByTestId("deal-handover-next"));
  for (let i = 0; i < 8; i++) {
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
