import { expect, test } from "@playwright/test";

const PROPOSE_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

test("handover readiness uses existing deal evidence and unlocks the governed flow", async ({
  page,
}) => {
  await page.goto(`/crm/handover?dealId=${PROPOSE_DEAL_ID}`, {
    waitUntil: "commit",
  });
  await expect(
    page.getByRole("heading", { name: "Handover to Delivery" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("handover-check-signed-scope")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByTestId("handover-check-key-date")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.getByTestId("handover-primary-disabled")).toBeVisible();

  await page
    .getByTestId("handover-brand-input")
    .fill("Client Drive folder received");
  await page.getByRole("button", { name: "Save brand evidence" }).click();
  await expect(page.getByTestId("handover-check-brand-assets")).toHaveAttribute(
    "data-ready",
    "true",
  );

  await page
    .getByTestId("handover-billing-input")
    .fill("TRN confirmed by Finance");
  await page.getByRole("button", { name: "Save billing evidence" }).click();
  await expect(
    page.getByTestId("handover-check-billing-details"),
  ).toHaveAttribute("data-ready", "true");

  await expect(page.getByTestId("handover-primary-action")).toHaveAttribute(
    "href",
    `/crm/deals/${PROPOSE_DEAL_ID}#handover`,
  );
  await expect(page.getByTestId("handover-readiness")).toContainText("6 of 6");
  await expect(page.getByTestId("handover-archive-gap")).toContainText(
    "Archive is still a separate Mile 2 gap",
  );
});
