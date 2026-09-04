import { expect, test } from "@playwright/test";

const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

test("deal detail shows the eight-stage path and saves its next action", async ({
  page,
}) => {
  await page.goto(`/crm/deals/${PROPOSE_DEAL_ID}`, {
    waitUntil: "commit",
  });

  await expect(page.getByTestId("deal-stage")).toHaveCount(8);
  await expect(
    page.getByTestId("deal-stage").filter({ hasText: "Send proposal" }),
  ).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("deal-next-gate")).toContainText(
    "Build the scope and client pricing",
  );

  const title = page.getByTestId("deal-next-action-title");
  const dueDate = page.getByTestId("deal-next-action-date");
  await expect(title).toHaveValue("Send revised JWMM proposal deck");
  await expect(dueDate).not.toHaveValue("");
  await page.getByTestId("deal-next-action-save").click();
  await expect(page.getByRole("status")).toContainText(
    "Next action updated and assigned to you.",
  );

  const objective = page.getByTestId("deal-need-objective");
  await objective.fill("Launch a winter positioning campaign");
  await page.getByTestId("deal-needs-save").click();
  await expect(page.getByRole("status")).toContainText(
    "Client needs snapshot saved.",
  );
  await page.reload({ waitUntil: "commit" });
  await expect(page.getByTestId("deal-need-objective")).toHaveValue(
    "Launch a winter positioning campaign",
  );
});
