import { expect, test } from "@playwright/test";

test("pipeline filters can be saved and the archive remains searchable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.localStorage.removeItem("hrmny.crm.pipeline-views.v1"),
  );
  await page.goto("/crm", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible({
    timeout: 60_000,
  });

  const records = page.getByLabel("Record view");
  const source = page.getByLabel("Campaign or source");
  const market = page.getByLabel("Market");
  await records.selectOption("all");
  await source.selectOption("apollo_intent");
  await market.selectOption("KSA");

  await page.getByTestId("pipeline-view-name").fill("KSA Apollo prospects");
  await page.getByTestId("pipeline-save-view").click();
  await expect(page.getByTestId("pipeline-saved-view")).toHaveValue(/.+/);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(records).toHaveValue("active");
  await expect(source).toHaveValue("all");
  await expect(market).toHaveValue("all");

  await page
    .getByTestId("pipeline-saved-view")
    .selectOption({ label: "KSA Apollo prospects" });
  await expect(records).toHaveValue("all");
  await expect(source).toHaveValue("apollo_intent");
  await expect(market).toHaveValue("KSA");

  await records.selectOption("archive");
  await expect(page.locator("main")).toContainText(
    /Closed records move here after 90 days|No closed deals match this archive view/,
  );
});
