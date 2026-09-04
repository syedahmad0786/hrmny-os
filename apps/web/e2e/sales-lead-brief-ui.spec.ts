import { expect, test } from "@playwright/test";

test("a saved lead brief survives reload and guides the email step", async ({
  page,
}) => {
  const company = `Brief Proof ${Date.now()}`;
  await page.goto("/crm/deals", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByPlaceholder("New company").fill(company);
  await page.getByRole("button", { name: "Create deal" }).click();
  await page.getByPlaceholder("Search deals").fill(company);
  await page.getByRole("row", { name: new RegExp(company) }).click();

  await expect(page.getByTestId("deal-sales-path")).toContainText(
    "Research company",
  );
  await page
    .getByPlaceholder("Add a note…")
    .fill(
      [
        `SALES KNOWLEDGE BRIEF — ${company}`,
        `Research request: ${crypto.randomUUID()}`,
        "",
        "Verified signal for the sales team.",
        "",
        "VERIFIED WEB SOURCES",
        "[1] Fixture — https://sources.hrmny.co/fixtures/sales-brief",
      ].join("\n"),
    );
  await page
    .getByPlaceholder("Add a note…")
    .locator("xpath=..")
    .getByRole("button", { name: "Save" })
    .click();

  const brief = page.getByTestId("deal-knowledge-brief");
  await expect(brief).not.toHaveAttribute("open", "");
  await brief.getByText("Saved knowledge brief").click();
  await expect(brief).toHaveAttribute("open", "");
  await expect(brief).toContainText("Verified signal for the sales team.");
  await page.reload({ waitUntil: "commit" });
  await expect(brief).not.toHaveAttribute("open", "");
  await brief.getByText("Saved knowledge brief").click();
  await expect(brief).toContainText("Verified signal for the sales team.");

  await page.getByRole("button", { name: "Find email" }).click();
  await expect(page.getByText("Action blocked")).toBeVisible();
  await expect(
    page.getByText(/no reusable Apollo person receipt/i),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Find the work email in Apollo/i }),
  ).toBeVisible();
});
