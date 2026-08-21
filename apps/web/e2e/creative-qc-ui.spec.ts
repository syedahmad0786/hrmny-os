import { expect, test } from "@playwright/test";

/** Demo Co creative task seeded at `qc` (memory + SQL). */
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";

/**
 * Creative Pass QC → client_review via UI (mock-safe).
 * Uses creative_director so the QC gate matches the staff tip on /creative.
 */
test.describe("Creative Pass QC UI", () => {
  test("Pass QC advances seed task to client_review", async ({
    page,
    request,
  }) => {
    // Fresh seed at status=qc (other e2es may have advanced the demo task).
    const reset = await request.post("/api/trpc/m4.reset", {
      headers: {
        "x-dev-role": "creative_director",
        "content-type": "application/json",
      },
      data: { json: null },
    });
    const resetText = await reset.text();
    expect(reset.ok(), resetText).toBeTruthy();
    expect(resetText).not.toMatch(/"error"/);

    page.setExtraHTTPHeaders({ "x-dev-role": "creative_director" });
    await page.goto(`/creative?taskId=${DEMO_CREATIVE_TASK_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: /^Creative$/i })).toBeVisible(
      { timeout: 60_000 },
    );

    const meta = page.getByTestId("creative-task-meta");
    await expect(meta).toContainText(/status=qc/i, { timeout: 30_000 });
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
  });
});
