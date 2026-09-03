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

export async function advanceDealToClose(page: Page) {
  const ready = page
    .getByTestId("deal-mark-won")
    .or(page.getByTestId("deal-handover"))
    .or(page.getByTestId("deal-handover-next"));
  for (let i = 0; i < 8; i++) {
    if (await ready.isVisible()) return;
    await advanceDealOnce(page);
  }
  await expect(ready).toBeVisible({ timeout: 5_000 });
}
