import { expect, test } from "@playwright/test";

async function openProgrammes(page: import("@playwright/test").Page) {
  await page.getByTestId("discovery-view-programmes").click();
  await expect(page.getByTestId("discovery-programmes")).toBeVisible({
    timeout: 60_000,
  });
}

async function createProgramme(
  page: import("@playwright/test").Page,
  name: string,
) {
  await openProgrammes(page);
  await page.getByTestId("discovery-new-programme").click();
  await page.getByTestId("discovery-programme-name").fill(name);
  await page.getByTestId("discovery-save-draft").click();
  await expect(page.getByTestId("discovery-programme-note")).toContainText(
    /Draft saved as version 1.*does not start research/i,
    { timeout: 30_000 },
  );
}

test.describe("Discovery programme configuration", () => {
  test("saves, reopens and publishes configuration without claiming execution", async ({
    page,
  }) => {
    const name = `E2E Discovery ${Date.now()}`;
    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await createProgramme(page, name);
    await expect(page.getByTestId("discovery-programmes")).toContainText(name);
    await expect(page.getByTestId("discovery-execution-status")).toContainText(
      /Execution status: unavailable.*Collectors and provider calls stay off.*No run is armed yet/i,
    );
    await expect(
      page.getByTestId("discovery-source-campaign_me"),
    ).toContainText(/candidate.*No account needed/i);
    const source = page.getByTestId("discovery-source-campaign_me");
    const sourceUrl = `https://campaignme.com/latest/?e2e=${Date.now()}`;
    const question = "Which buyer owns the budget, and what changed?";
    const inclusionRule = "Keep UAE evidence, even when the source has commas.";
    const exclusionRule = "Do not infer budget, authority, or intent.";
    await page
      .getByText("Ownership, review and acquisition lanes", { exact: true })
      .click();
    await page.getByLabel("Programme owner").selectOption({
      label: "Dev Partner",
    });
    await source.locator("summary").click();
    await source.getByLabel("Source URL").fill(sourceUrl);
    await page
      .getByLabel("Opportunity types")
      .fill("Agency review\nHiring signal");
    await page
      .getByLabel("Questions")
      .fill(`${question}\nWhich HRMNY service is relevant?`);
    await page.getByText("Advanced criteria", { exact: true }).click();
    await page.getByLabel("Inclusion rules").fill(inclusionRule);
    await page.getByLabel("Exclusion rules").fill(exclusionRule);
    await page
      .getByText("Schedule, sector rotation and run limits", { exact: true })
      .click();
    await page.getByRole("checkbox", { name: "Sunday" }).check();
    await page.getByRole("checkbox", { name: "Friday" }).uncheck();
    await page.getByLabel("Maximum observations per run").fill("123");
    await page.getByTestId("discovery-save-draft").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Draft saved as version 2/i,
      { timeout: 30_000 },
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await openProgrammes(page);
    await page
      .getByTestId("discovery-programmes")
      .getByText(name, { exact: true })
      .click();
    await expect(page.getByTestId("discovery-programme-name")).toHaveValue(
      name,
    );
    await source.locator("summary").click();
    await expect(source.getByLabel("Source URL")).toHaveValue(sourceUrl);
    await expect(page.getByLabel("Opportunity types")).toHaveValue(
      "Agency review\nHiring signal",
    );
    await expect(page.getByLabel("Questions")).toHaveValue(
      `${question}\nWhich HRMNY service is relevant?`,
    );
    await page
      .getByText("Ownership, review and acquisition lanes", { exact: true })
      .click();
    await expect(page.getByLabel("Programme owner")).toHaveValue(
      "c0000000-0000-4000-8000-000000000001",
    );
    await page.getByText("Advanced criteria", { exact: true }).click();
    await expect(page.getByLabel("Inclusion rules")).toHaveValue(inclusionRule);
    await expect(page.getByLabel("Exclusion rules")).toHaveValue(exclusionRule);
    await page
      .getByText("Schedule, sector rotation and run limits", { exact: true })
      .click();
    await expect(page.getByRole("checkbox", { name: "Sunday" })).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Friday" }),
    ).not.toBeChecked();
    await expect(page.getByLabel("Maximum observations per run")).toHaveValue(
      "123",
    );
    await page.getByTestId("discovery-publish-programme").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Published version 2.*Execution is not wired yet/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("discovery-execution-status")).toContainText(
      /Armed next Dubai slot/i,
    );
    await page.getByTestId("discovery-pause-programme").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Programme paused at version 4/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("discovery-execution-status")).toContainText(
      /No run is armed yet/i,
    );
    await page.getByTestId("discovery-publish-programme").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Published version 2.*Execution is not wired yet/i,
      { timeout: 30_000 },
    );
  });

  test("allows an operator to save their own draft but not publish shared criteria", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await createProgramme(page, `E2E AM Discovery ${Date.now()}`);
    await expect(
      page.getByTestId("discovery-publish-programme"),
    ).toBeDisabled();
  });

  test("keeps local edits visible when another tab saves first", async ({
    page,
    context,
  }) => {
    const name = `E2E Conflict ${Date.now()}`;
    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await createProgramme(page, name);
    await page
      .getByTestId("discovery-programme-name")
      .fill(`${name} local change`);

    const other = await context.newPage();
    await other.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await openProgrammes(other);
    await other
      .getByTestId("discovery-programmes")
      .getByText(name, { exact: true })
      .click();
    await expect(other.getByTestId("discovery-programme-name")).toHaveValue(
      name,
    );
    await other.getByTestId("discovery-programme-name").fill(`${name} remote`);
    await other.getByTestId("discovery-save-draft").click();
    await expect(other.getByTestId("discovery-programme-note")).toContainText(
      /Draft saved as version 2/i,
      { timeout: 30_000 },
    );
    await other.close();

    await page.bringToFront();
    await page.waitForTimeout(250);
    await expect(page.getByTestId("discovery-programme-name")).toHaveValue(
      `${name} local change`,
    );
    await page.getByTestId("discovery-save-draft").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /changed elsewhere.*unsaved changes remain here/i,
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("button", { name: "Discard local changes & reload" }),
    ).toBeVisible();
    await expect(page.getByTestId("discovery-programme-name")).toHaveValue(
      `${name} local change`,
    );
  });

  test("keeps Review, Sources and Runs truthful while execution stays off", async ({
    page,
  }) => {
    const name = `E2E Runs ${Date.now()}`;
    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("discovery-review")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("discovery-review-status")).toContainText(
      /Candidate store: operator submissions only/i,
    );
    await expect(page.getByTestId("discovery-review-status")).toContainText(
      /Collectors stay off/i,
    );
    await expect(page.getByTestId("discovery-review-needs-review")).toHaveText(
      /^\d+$/,
    );
    await page.screenshot({
      path: "e2e/runtime-proof/discovery-review.png",
      fullPage: true,
    });
    await page.getByTestId("discovery-view-sources").click();
    await expect(page.getByTestId("discovery-sources-status")).toContainText(
      /Collector coverage: not accepted/i,
    );
    await expect(page.getByTestId("discovery-control-queue")).toBeVisible();
    await expect(page.getByTestId("discovery-control-health")).toContainText(
      /Collectors stay off/i,
    );
    for (const source of [
      "campaign_me",
      "communicate_online",
      "gulf_business",
      "arabian_business",
      "gulf_news_business",
      "khaleej_times_business",
      "the_national_business",
      "time_out_dubai",
    ]) {
      await expect(
        page.getByTestId(`discovery-source-status-${source}`),
      ).toBeVisible();
    }
    await page.screenshot({
      path: "e2e/runtime-proof/discovery-sources.png",
      fullPage: true,
    });
    await createProgramme(page, name);
    await page.screenshot({
      path: "e2e/runtime-proof/discovery-programmes.png",
      fullPage: true,
    });
    await page.getByTestId("discovery-publish-programme").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Published version 1.*Execution is not wired yet/i,
      { timeout: 30_000 },
    );
    await page.getByTestId("discovery-view-sources").click();
    await expect(page.getByTestId("discovery-policy-propose")).toBeVisible();
    await openProgrammes(page);
    await page
      .getByTestId("discovery-programmes")
      .getByText(name, { exact: true })
      .click();
    await expect(page.getByTestId("discovery-queue-run-now")).toBeVisible();
    await page.getByTestId("discovery-queue-run-now").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Run pending.*Collectors stay off/i,
      { timeout: 30_000 },
    );
    await page.getByTestId("discovery-view-runs").click();
    await expect(
      page.getByTestId("discovery-runs-execution-status"),
    ).toContainText(/Execution status: unavailable/i);
    await expect(page.getByTestId("discovery-runs")).toContainText(name);
    await page.screenshot({
      path: "e2e/runtime-proof/discovery-runs.png",
      fullPage: true,
    });
    await page
      .locator('[data-testid^="discovery-run-"]')
      .filter({ hasText: name })
      .filter({ hasText: "pending" })
      .first()
      .click();
    await expect(page.getByTestId("discovery-run-detail")).toContainText(
      /n8n has not claimed this run/i,
    );
    await page.getByTestId("discovery-cancel-run").click();
    await expect(page.getByTestId("discovery-run-note")).toContainText(
      /cancelled.*No collector was started/i,
      { timeout: 30_000 },
    );
    await page.screenshot({
      path: "e2e/runtime-proof/discovery-run-cancelled.png",
      fullPage: true,
    });
  });

  test("reviews an operator-submitted candidate without starting collectors", async ({
    page,
  }) => {
    const name = `E2E Review ${Date.now()}`;
    const host = `e2e-review-${Date.now()}.campaignme.com`;
    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/research", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("discovery-review")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("discovery-candidate-name").fill(name);
    await page
      .getByTestId("discovery-candidate-website")
      .fill(`https://${host}`);
    await page
      .getByTestId("discovery-candidate-why")
      .fill("A dated listing named a relevant UAE creative review.");
    await page
      .getByTestId("discovery-candidate-source-url")
      .fill(`https://${host}/latest/e2e-${Date.now()}`);
    await page
      .getByTestId("discovery-candidate-excerpt")
      .fill("The brand opened a regional review and named hospitality work.");
    await page
      .getByTestId("discovery-candidate-event-date")
      .fill(new Date().toISOString().slice(0, 10));
    await page.getByTestId("discovery-candidate-save").click();
    await expect(page.getByTestId("discovery-review-note")).toContainText(
      /Saved needs review.*Collectors stay off/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("discovery-candidate-detail")).toContainText(
      name,
    );
    await expect(
      page.getByTestId("discovery-candidate-excerpt-text"),
    ).toContainText(/regional review/i);
    await expect(page.getByTestId("discovery-candidate-facts")).toContainText(
      /Event date/i,
    );
    await expect(
      page.getByTestId("discovery-candidate-interpretations"),
    ).toBeVisible();
    await page.getByTestId("discovery-candidate-accept").click();
    await expect(page.getByTestId("discovery-review-note")).toContainText(
      /Accepted and linked to one company.*No contact or deal was created/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("discovery-candidate-state")).toContainText(
      /accepted/i,
    );
    await page.screenshot({
      path: "e2e/runtime-proof/discovery-review-accepted.png",
      fullPage: true,
    });
  });
});
