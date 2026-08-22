import { expect, test } from "@playwright/test";

/** Demo Co creative task seeded at `qc` (memory + SQL). */
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";

/**
 * Creative Pass QC → client_review via UI (mock-safe).
 * Uses creative_director so the QC gate matches the staff tip on /creative.
 *
 * Do NOT call m4.reset here — it clears portal approvals + Client B and
 * breaks later funnel-demo portal/isolation e2es.
 */
test.describe("Creative Pass QC UI", () => {
  test("Pass QC advances seed task to client_review", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "creative_director" });
    await page.goto(`/creative?taskId=${DEMO_CREATIVE_TASK_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: /^Creative$/i })).toBeVisible(
      { timeout: 60_000 },
    );

    await expect(page.getByTestId("creative-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("creative-ready-canva")).toBeVisible();
    await expect(page.getByTestId("creative-ready-dam")).toContainText(/DAM/i);

    const meta = page.getByTestId("creative-task-meta");
    await expect(meta).toBeVisible({ timeout: 30_000 });

    // If a prior run already advanced this seed, assert the landed state.
    const metaText = (await meta.textContent()) ?? "";
    if (/status=client_review/i.test(metaText) && /qcPassed=true/i.test(metaText)) {
      await expect(meta).toContainText(/status=client_review/i);
      await expect(meta).toContainText(/qcPassed=true/i);
      return;
    }

    await expect(meta).toContainText(/status=qc/i);
    await expect(meta).toContainText(/qcPassed=false/i);

    // Gate: advance without QC should block.
    await page.getByTestId("creative-advance-expect-block").click();
    await expect(page.getByTestId("creative-qc-msg")).toContainText(/BLOCKED/i, {
      timeout: 30_000,
    });
    await expect(meta).toContainText(/status=qc/i);

    await page.getByTestId("creative-pass-qc").click();
    await expect(page.getByTestId("creative-qc-msg")).toContainText(
      /QC passed.*client_review/i,
      { timeout: 30_000 },
    );
    await expect(meta).toContainText(/status=client_review/i);
    await expect(meta).toContainText(/qcPassed=true/i);
    await expect(page.getByTestId("creative-portal-review")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("creative-portal-review").locator("a"),
    ).toHaveAttribute("href", /\/portal\//);
  });
});
