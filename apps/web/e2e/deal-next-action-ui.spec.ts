import { expect, test } from "@playwright/test";

test("deal detail shows the eight-stage path and saves its next action", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const companyName = `E2E next action ${suffix}`;
  const created = await request.post("/api/trpc/crm.deals.create", {
    headers: {
      "x-dev-role": "partner",
      "content-type": "application/json",
    },
    data: {
      json: {
        companyName,
        sector: "Hospitality",
        leadSourceLane: "relationship_led",
      },
    },
  });
  const createdText = await created.text();
  expect(created.ok(), createdText).toBeTruthy();
  const payload = JSON.parse(createdText) as {
    result?: { data?: { json?: { dealId?: string }; dealId?: string } };
  };
  const dealId =
    payload.result?.data?.json?.dealId ?? payload.result?.data?.dealId;
  expect(dealId).toMatch(/^[0-9a-f-]{36}$/i);

  page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
  await page.goto(`/crm/deals/${dealId}`, {
    waitUntil: "commit",
  });

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    companyName,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("deal-stage")).toHaveCount(8);
  await expect(
    page.getByTestId("deal-stage").filter({ hasText: "New lead" }),
  ).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("deal-next-gate")).toContainText(
    "Review the lead and decide whether it is worth pursuing",
  );

  const actionTitle = `Confirm first call ${suffix}`;
  const title = page.getByTestId("deal-next-action-title");
  const dueDate = page.getByTestId("deal-next-action-date");
  await expect(title).toHaveValue("");
  await expect(dueDate).toHaveValue("");
  await title.fill(actionTitle);
  await dueDate.fill("2099-12-31");
  await page.getByTestId("deal-next-action-save").click();
  await expect(page.getByRole("status")).toContainText("Next action created.");

  const needs = {
    "deal-need-objective": "Launch a winter positioning campaign",
    "deal-need-deliverables": "Campaign strategy and production assets",
    "deal-need-timing": "Launch this quarter",
    "deal-need-decision-maker": "Client marketing director",
  } as const;
  for (const [testId, value] of Object.entries(needs)) {
    await page.getByTestId(testId).fill(value);
  }
  await page.getByTestId("deal-needs-save").click();
  await expect(page.getByRole("status")).toContainText(
    "Client needs snapshot saved.",
  );

  await page.reload({ waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    companyName,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("deal-next-action-title")).toHaveValue(
    actionTitle,
  );
  await expect(page.getByTestId("deal-next-action-date")).toHaveValue(
    "2099-12-31",
  );
  for (const [testId, value] of Object.entries(needs)) {
    await expect(page.getByTestId(testId)).toHaveValue(value);
  }
});
