import { expect, test } from "@playwright/test";

test("personal mail switches accounts and folders without carrying an old message forward", async ({
  page,
}) => {
  const ids = [
    "aa000000-0000-4000-8000-000000000001",
    "aa000000-0000-4000-8000-000000000002",
  ];
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(
      url.pathname.split("/api/trpc/")[1]!,
    ).split(",");
    if (
      !names.some((name) =>
        /connections\.(myMailboxes|mailboxPage|mailboxMessage)$/.test(name),
      )
    )
      return route.continue();
    const response = await route.fetch();
    const results = await response.json();
    const input = JSON.parse(url.searchParams.get("input") ?? "{}");
    names.forEach((name, index) => {
      let json: unknown;
      if (name === "connections.myMailboxes")
        json = ids.map((connectionAccountId, i) => ({
          connectionAccountId,
          email: `employee@domain-${i}.test`,
          status: "connected",
          lastError: null,
        }));
      if (
        name === "connections.myMailboxes" &&
        route.request().headers()["x-dev-role"] === "am"
      )
        json = [];
      if (name === "connections.mailboxPage") {
        const params = input[index]?.json;
        json = {
          messages: [
            {
              id: "message1",
              subject: `${params.folder} ${params.pageToken ? "older" : "latest"} ${params.connectionAccountId === ids[0] ? "one" : "two"}`,
              from: "Buyer <buyer@client.test>",
              to: "employee@domain-0.test",
              snippet: "Client conversation",
              date: "",
            },
          ],
          nextPageToken: params.pageToken ? null : "older",
        };
      }
      if (name === "connections.mailboxMessage")
        json = { body: "Private message body <script>never execute</script>" };
      if (json !== undefined) results[index] = { result: { data: { json } } };
    });
    await route.fulfill({ response, status: 200, json: results });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/crm/inbox");
  await page.getByRole("button", { name: "My inbox & sent mail" }).click();
  await page.getByRole("button", { name: /INBOX latest one/ }).click();
  await expect(
    page.getByText("Private message body", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /SENT latest one/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Private message body", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Older", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /SENT older one/ }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Mailbox", exact: true })
    .selectOption(ids[1]!);
  await expect(
    page.getByRole("button", { name: /SENT latest two/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Newer", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /SENT latest two/ }).click();
  await expect(
    page.getByText("Private message body", { exact: false }),
  ).toBeVisible();
  await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
  await page.getByRole("combobox", { name: "Dev only" }).selectOption("am");
  await expect(
    page.getByText("Private message body", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "My inbox & sent mail" }).click();
  await expect(
    page.getByText("Connect your own Google mailbox", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.unrouteAll({ behavior: "wait" });
});
