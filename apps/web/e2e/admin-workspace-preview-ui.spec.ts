import { expect, test } from "@playwright/test";

test("admin can enter an employee view, navigate back and return to self", async ({
  page,
}) => {
  await page.goto("/crm/hunt");
  await page.getByTestId("workspace-back").click();
  await expect(page).toHaveURL(/\/crm\/dashboard$/);
  await page.getByTestId("account-menu").click();
  await page
    .getByTestId("workspace-employee")
    .selectOption({ label: "Dev AM" });
  await expect(page.getByTestId("workspace-preview-banner")).toContainText(
    "Dev AM",
  );
  await expect(page.getByTestId("role-home-label")).toContainText(
    "Account management",
  );
  await page.goto("/work/my-tasks");
  await expect(page.locator("fieldset.desk-preview-content")).toBeDisabled();
  await page.goto("/crm/inbox");
  await expect(
    page.getByRole("heading", {
      name: "This area is outside employee preview",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to my workspace", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("workspace-preview-banner")).toHaveCount(0);
  await expect(page.getByTestId("role-home-label")).toContainText("Partner");
});

test("ordinary staff have a labelled account menu without employee switching", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
  await page.goto("/");
  await page.getByTestId("account-menu").click();
  await expect(page.getByTestId("workspace-employee")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Connected tools/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open notifications" }),
  ).toBeVisible();
});
