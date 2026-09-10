import { expect, test } from "@playwright/test";

test("inline review requires separate exact decisions and LinkedIn only copies", async ({
  page,
  context,
}, testInfo) => {
  const id = "c0000000-0000-4000-8000-000000000009";
  const mailbox = "c0000000-0000-4000-8000-000000000010";
  const calls: { path: string; input: unknown }[] = [];
  let state = "draft";
  let channel = "gmail";
  const hash = () => (state === "draft" ? "a" : "b").repeat(64);
  await page.route("**/api/trpc/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const paths = decodeURIComponent(
      url.pathname.split("/api/trpc/")[1]!,
    ).split(",");
    const inputs =
      request.method() === "POST"
        ? request.postDataJSON()
        : JSON.parse(url.searchParams.get("input") ?? "{}");
    const results = paths.map((path, index) => {
      const input = inputs[index]?.json;
      let data: unknown;
      if (path === "leadgen.outreach.review")
        data = {
          item: {
            id,
            channel,
            state,
            recipient:
              channel === "gmail"
                ? "prospect@example.com"
                : "https://www.linkedin.com/in/synthetic-review",
            subject: "A review-only idea",
            body: "A synthetic outreach draft. No provider is connected in this browser test.",
            linkedinUrl: "https://www.linkedin.com/in/synthetic-review",
          },
          snapshotHash: hash(),
          ready: state !== "sent",
          reason: null,
        };
      else if (path === "connections.salesMailboxes")
        data = {
          items: [
            {
              connectionAccountId: mailbox,
              label: "Synthetic mailbox",
              email: "sender@example.com",
            },
          ],
        };
      else if (
        path === "leadgen.outreach.reviewApprove" ||
        path === "leadgen.outreach.reviewSend"
      ) {
        calls.push({ path, input });
        state = path.endsWith("reviewApprove") ? "approved" : "sent";
        data = { ok: true };
      } else throw new Error(`Unexpected review request: ${path}`);
      return { result: { data: { json: data } } };
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(results),
    });
  });
  const response = await page.goto(`/assistant/review/outreach/${id}`, { waitUntil: "domcontentloaded" });
  expect(response?.headers()["content-security-policy"]).toBe("frame-ancestors 'self' https://hrmny-portal.fly.dev");
  await expect(
    page.getByRole("heading", { name: "Outreach draft" }),
  ).toBeVisible();
  await expect(page.getByLabel("Outreach body")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByRole("button", { name: "Send this email" }),
  ).toBeDisabled();
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: "Approve draft" }).click();
  await expect(
    page.getByRole("button", { name: "Approve draft" }),
  ).toBeDisabled();
  await page.getByLabel("Send from").selectOption(mailbox);
  await expect(
    page.getByRole("button", { name: "Send this email" }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("email-review-mocked.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Send this email" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls).toEqual([
    {
      path: "leadgen.outreach.reviewApprove",
      input: { id, snapshotHash: "a".repeat(64) },
    },
    {
      path: "leadgen.outreach.reviewSend",
      input: {
        id,
        snapshotHash: "b".repeat(64),
        senderConnectionAccountId: mailbox,
      },
    },
  ]);
  channel = "linkedin_connect";
  state = "draft";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Outreach body")).toBeEditable();
  await page.getByLabel("Outreach body").fill("My edited connection note");
  await expect(
    page.getByRole("button", { name: "Send this email" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open LinkedIn" }),
  ).toHaveAttribute("href", "https://www.linkedin.com/in/synthetic-review");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy text" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Copied. Paste into LinkedIn and send manually.",
  );
  expect(calls.length).toBe(2);
  await page.screenshot({
    path: testInfo.outputPath("linkedin-review-mocked.png"),
    fullPage: true,
  });
});
