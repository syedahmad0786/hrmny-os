import { expect, test } from "@playwright/test";

async function fillSourcedProposal(
  page: import("@playwright/test").Page,
  input: { company: string; evidence: string },
) {
  await page.getByTestId("sales-os-signal-company").fill(input.company);
  await page.getByLabel("Sector").fill("Retail");
  await page
    .getByTestId("sales-os-signal-why")
    .fill(
      "Synthetic Dubai flagship launch with a Head of Marketing hiring signal.",
    );
  await page.getByTestId("sales-os-signal-evidence").fill(input.evidence);
  await page.getByTestId("sales-os-create-proposal").click();
  await expect(page.getByTestId("sales-os-research-note")).toContainText(
    /Proposal ready for Gate 1.*no CRM company created/i,
    { timeout: 30_000 },
  );
}

test.describe("Sales research proposal boundary", () => {
  test("captures sourced evidence before Gate 1 promotion", async ({
    page,
  }) => {
    const suffix = Date.now();
    const company = `E2E Northstar ${suffix}`;
    const evidence = `https://sources.hrmny.co/e2e/research-${suffix}`;

    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sales-os-signal-form")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("sales-os-run-research")).toHaveCount(0);

    await fillSourcedProposal(page, { company, evidence });
    const proposal = page
      .getByTestId("sales-os-company")
      .filter({ hasText: company });
    await expect(proposal).toBeVisible();
    await expect(
      proposal.getByRole("link", { name: "View source evidence" }),
    ).toHaveAttribute("href", evidence);

    await proposal.getByRole("button", { name: "Approve" }).click();
    await expect(proposal).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page.locator(".crm-panel").filter({
        has: page.getByRole("heading", { name: "Approved — find people" }),
      }),
    ).toContainText(company);
  });

  test("keeps non-Sales staff on a truthful read-only surface", async ({
    page,
  }) => {
    const suffix = Date.now();
    const company = `E2E HR Read Only ${suffix}`;
    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await fillSourcedProposal(page, {
      company,
      evidence: `https://sources.hrmny.co/e2e/hr-read-only-${suffix}`,
    });

    await page.setExtraHTTPHeaders({ "x-dev-role": "hr" });
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("sales-os-research-view-only")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("sales-os-signal-form")).toHaveCount(0);
    const proposal = page
      .getByTestId("sales-os-company")
      .filter({ hasText: company });
    await expect(proposal).toBeVisible();
    const decisionButtons = proposal.getByRole("button");
    await expect(decisionButtons).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(decisionButtons.nth(index)).toBeDisabled();
    }
  });

  test("keeps signal capture usable at a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("sales-os-signal-form")).toBeVisible({
      timeout: 60_000,
    });
    const suffix = Date.now();
    await fillSourcedProposal(page, {
      company: `E2E Mobile Signal ${suffix}`,
      evidence: `https://sources.hrmny.co/e2e/mobile-${suffix}`,
    });
    for (const testId of [
      "sales-os-signal-company",
      "sales-os-signal-evidence",
      "sales-os-signal-why",
      "sales-os-create-proposal",
    ]) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box, `${testId} has a bounding box`).not.toBeNull();
      expect(
        box!.x,
        `${testId} starts inside the viewport`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        box!.x + box!.width,
        `${testId} ends inside the viewport`,
      ).toBeLessThanOrEqual(391);
    }
    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  });
});
