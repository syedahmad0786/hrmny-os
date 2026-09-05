import { expect, test } from "@playwright/test";

test("workbook records, saved views, follow-ups and Excel export work together", async ({
  page,
}) => {
  const stamp = Date.now();
  const company = `Cedar Browser ${stamp}`;
  await page.goto("/crm/companies", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(company);
  await page.getByRole("button", { name: "Create record" }).click();
  await page.getByPlaceholder("Search companies").fill(company);
  await expect(
    page.getByRole("link", { name: company, exact: true }),
  ).toBeVisible();
  await page.getByLabel(`Select ${company}`, { exact: true }).check();
  await page.getByRole("button", { name: "Assign owner" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("New value")
    .selectOption({ label: "Dev AM" });
  await page.getByRole("button", { name: /Apply.*change/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: company }),
  ).toContainText("Dev AM");
  await page
    .getByLabel("View name", { exact: true })
    .fill(`Cedar view ${stamp}`);
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(page.getByText("View saved.", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByLabel("Saved workbook view")
    .selectOption({ label: `Cedar view ${stamp} · Personal` });
  await expect(page.getByPlaceholder("Search companies")).toHaveValue(company);
  await page.getByText("Export", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Current view · Excel" }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.goto("/crm/contacts", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await page.getByLabel("First name", { exact: true }).fill(`Noor ${stamp}`);
  await page
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption({ label: company });
  await page
    .getByRole("textbox", { name: "Work email", exact: true })
    .fill(`noor.${stamp}@example.test`);
  await page.getByRole("button", { name: "Create record" }).click();
  await page.getByPlaceholder("Search contacts").fill(`Noor ${stamp}`);
  await page
    .getByRole("checkbox", { name: "Show test records", exact: true })
    .check();
  await page.getByRole("link", { name: `Noor ${stamp}`, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `Noor ${stamp}`, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Role", { exact: true }).fill("Operations director");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page
    .getByLabel("Next action", { exact: true })
    .fill(`Call Cedar ${stamp}`);
  await page.getByLabel("Due date", { exact: true }).fill("2026-01-01");
  await page
    .getByRole("button", { name: "Add follow-up", exact: true })
    .click();
  await page.goto("/crm/followups", { waitUntil: "commit" });
  await page.getByPlaceholder("Search follow-ups").fill(`Call Cedar ${stamp}`);
  await expect(
    page.getByRole("row").filter({ hasText: `Call Cedar ${stamp}` }),
  ).toContainText(company);
});

test("reviewed Asana roster creates a linked client with source provenance and no invented terms", async ({
  page,
}) => {
  const stamp = Date.now();
  const name = `Cedar Roster ${stamp}`;
  const csv = `clientName,projectName,projectId,workspaceId,observedAt\n${name},Cedar launch,${stamp}1,1148006162435561,2026-01-01T00:00:00Z\n${name},Cedar content,${stamp}2,1148006162435561,2026-01-01T00:00:00Z`;
  await page.goto("/clients", { waitUntil: "commit" });
  await page
    .getByText("Import reviewed Asana client projects", { exact: true })
    .click();
  await page.getByLabel("Review roster CSV").setInputFiles({
    name: "roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByRole("caption")).toContainText("2 rows");
  await page.getByRole("button", { name: "Confirm reviewed roster" }).click();
  await expect(page.getByRole("status")).toContainText(
    "1 client accounts created · 2 projects linked",
  );
  await page.getByLabel("Search clients").fill(name);
  await page.getByRole("link", { name: /Open client workspace/ }).click();
  await expect(
    page.getByRole("heading", { name: "Asana client projects" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cedar launch", exact: true }),
  ).toHaveAttribute("href", /app.asana.com/);
  await expect(page.getByTestId("client-account-overview")).toContainText(
    "Not recorded",
  );
});
