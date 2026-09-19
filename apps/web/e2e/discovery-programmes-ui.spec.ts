import { expect, test } from "@playwright/test";

async function createProgramme(
  page: import("@playwright/test").Page,
  name: string,
) {
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
    await expect(page.getByTestId("discovery-programmes")).toBeVisible({
      timeout: 60_000,
    });
    await createProgramme(page, name);
    await expect(page.getByTestId("discovery-programmes")).toContainText(name);
    await expect(page.getByTestId("discovery-execution-status")).toContainText(
      /Execution status: unavailable.*No Discovery schedule, collector, source test, or provider call is wired yet/i,
    );
    await expect(
      page.getByTestId("discovery-source-campaign_me"),
    ).toContainText(/candidate.*No account needed/i);
    const source = page.getByTestId("discovery-source-campaign_me");
    const sourceUrl = `https://campaignme.com/latest/?e2e=${Date.now()}`;
    await source.locator("summary").click();
    await source.getByLabel("Source URL").fill(sourceUrl);
    await page.getByTestId("discovery-save-draft").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Draft saved as version 2/i,
      { timeout: 30_000 },
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByTestId("discovery-programmes")
      .getByText(name, { exact: true })
      .click();
    await expect(page.getByTestId("discovery-programme-name")).toHaveValue(
      name,
    );
    await source.locator("summary").click();
    await expect(source.getByLabel("Source URL")).toHaveValue(sourceUrl);
    await page.getByTestId("discovery-publish-programme").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Published version 2.*Execution is not wired yet/i,
      { timeout: 30_000 },
    );
    await page.getByTestId("discovery-pause-programme").click();
    await expect(page.getByTestId("discovery-programme-note")).toContainText(
      /Programme paused at version 4/i,
      { timeout: 30_000 },
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
});
