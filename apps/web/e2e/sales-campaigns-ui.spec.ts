import { expect, test } from "@playwright/test";

const VERIFIED_CONTACT_ID = "12000000-0000-4000-8000-000000000001";

test.describe("Sales campaign draft-only execution", () => {
  test("creates a campaign, prepares drafts, and exposes a zero-send receipt", async ({
    page,
    request,
  }) => {
    const suffix = Date.now();
    const companyName = `E2E campaign prospect ${suffix}`;
    const created = await request.post("/api/trpc/crm.deals.create", {
      headers: {
        "x-dev-role": "partner",
        "content-type": "application/json",
      },
      data: {
        json: {
          companyName,
          primaryContactId: VERIFIED_CONTACT_ID,
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

    await page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/campaigns", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Campaigns", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Sales sections" })
        .getByRole("link", { name: "Campaigns", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByText("Campaign controls never send client email."),
    ).toBeVisible();

    const name = `E2E draft-only campaign ${suffix}`;
    await page.getByTestId("campaign-name").fill(name);
    await page.getByTestId(`campaign-deal-${dealId}`).check();
    await page.getByTestId("campaign-create").click();
    await expect(page.getByRole("status")).toContainText(`${name} created`);

    const campaign = page
      .locator("article.crm-panel")
      .filter({ hasText: name });
    await expect(campaign).toBeVisible();
    await expect(campaign).toContainText("No runs yet");
    await campaign
      .getByRole("button", { name: "Prepare first drafts" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "1 first-touch drafts prepared · 0 sent",
    );
    await expect(campaign).toContainText("awaits human review");
    await expect(campaign.getByText("0 sent", { exact: false })).toBeVisible();
    await expect(campaign.locator("code")).toHaveCount(1);

    await campaign
      .getByRole("button", { name: "Prepare due follow-ups" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "0 follow-up drafts prepared · 0 sent",
    );
    await expect(campaign.locator("code")).toHaveCount(2);
  });
});
