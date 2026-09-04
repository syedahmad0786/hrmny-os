import { expect, test } from "@playwright/test";

test("Gmail reply appears in Sales inbox and hands off an approval-gated draft", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  const subject = `Re: E2E inbox proof ${suffix}`;
  const body = `Thanks for the campaign overview. Tuesday works. ${suffix}`;
  const draftId = "78000000-0000-4000-8000-000000000001";
  let drafted = false;

  await page.route("**/api/trpc/**", async (route) => {
    const procedurePath = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/api/trpc/")[1] ?? "",
    );
    const procedures = procedurePath.split(",");
    const listIndex = procedures.indexOf("leadgen.outreach.conversations");
    const draftIndex = procedures.indexOf("leadgen.outreach.draftReply");
    if (listIndex < 0 && draftIndex < 0) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const original = (await response.json()) as unknown;
    const results = Array.isArray(original) ? original : [original];
    if (draftIndex >= 0) {
      drafted = true;
      results[draftIndex] = {
        result: {
          data: {
            json: {
              id: draftId,
              dealId: "e0000000-0000-4000-8000-000000000001",
              channel: "gmail",
              state: "draft",
              recipient: "layla.hassan@example-jwmm.ae",
              subject,
              body: "Tuesday works. I will send a short agenda before the call.",
            },
          },
        },
      };
    }
    if (listIndex >= 0) {
      results[listIndex] = {
        result: {
          data: {
            json: [
              {
                id: `thread:gmail-e2e-thread-${suffix}`,
                threadId: `gmail-e2e-thread-${suffix}`,
                dealId: "e0000000-0000-4000-8000-000000000001",
                contactId: "12000000-0000-4000-8000-000000000001",
                outreachItemId: "77000000-0000-4000-8000-000000000001",
                senderConnectionAccountId:
                  "70000000-0000-4000-8000-000000000001",
                companyName: "JW Marriott Marquis Dubai",
                contactName: "Layla Hassan",
                contactEmail: "layla.hassan@example-jwmm.ae",
                subject,
                lastMessageAt: "2026-09-04T10:00:00.000Z",
                latestInboundBody: body,
                latestInboundAt: "2026-09-04T10:00:00.000Z",
                latestInboundMessageId: "<gmail-e2e-reply@example.com>",
                replyDraftId: drafted ? draftId : null,
                messages: [
                  {
                    id: "gmail-event-outbound",
                    direction: "outbound",
                    status: "sent",
                    from: "sales@hrmny.co",
                    to: "layla.hassan@example-jwmm.ae",
                    subject: subject.replace(/^Re:\s*/i, ""),
                    body: "Original approved outreach",
                    occurredAt: "2026-09-04T09:00:00.000Z",
                  },
                  {
                    id: "gmail-event-inbound",
                    direction: "inbound",
                    status: "replied",
                    from: "layla.hassan@example-jwmm.ae",
                    to: "sales@hrmny.co",
                    subject,
                    body,
                    occurredAt: "2026-09-04T10:00:00.000Z",
                  },
                ],
              },
            ],
          },
        },
      };
    }
    await route.fulfill({
      response,
      json: Array.isArray(original) ? results : results[0],
    });
  });

  page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
  await page.goto("/crm/inbox", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Sales inbox" })).toBeVisible({
    timeout: 60_000,
  });
  const conversation = page
    .getByTestId("sales-conversation")
    .filter({ hasText: subject });
  await expect(conversation).toBeVisible({ timeout: 30_000 });
  await expect(conversation).toContainText("JW Marriott Marquis Dubai");
  await expect(conversation).toContainText(body);

  await conversation
    .getByPlaceholder(/Write the reply/i)
    .fill("Tuesday works. I will send a short agenda before the call.");
  await conversation.getByTestId("draft-conversation-reply").click();
  const review = conversation.getByTestId("review-reply-draft");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review).toHaveAttribute("href", `/crm/outreach?id=${draftId}`);
  await expect(conversation.getByRole("button", { name: /send/i })).toHaveCount(
    0,
  );
  // This browser proof deliberately stops before approval or provider delivery.
});
