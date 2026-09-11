import { expect, test } from "@playwright/test";

/**
 * Dedicated Google Workspace OAuth — Connect no longer uses Supabase SSO,
 * Heal is not auto-fired, and OAuth return banners are visible.
 */
test.describe("Connections Google Workspace OAuth", () => {
  test("mailbox card is first and OAuth banners render", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/connections?gw=error&reason=access_denied", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: /Connections/i }),
    ).toBeVisible({ timeout: 60_000 });

    const gwCard = page.getByTestId("conn-card-google_workspace");
    await expect(gwCard).toBeVisible({ timeout: 30_000 });
    await expect(
      gwCard.getByRole("heading", { name: /Google Workspace/i }),
    ).toBeVisible();
    await expect(gwCard).not.toContainText(
      /Blocked by the organization connected-app policy/i,
    );
    const chatReadConsent = page.getByTestId("conn-google-chat-read-consent");
    await expect(chatReadConsent).toBeVisible();
    await expect(chatReadConsent).toContainText(
      /Add Google Chat to Google Workspace/i,
    );
    await expect(chatReadConsent).toContainText(
      /basic account profile, Gmail read and send, Calendar event read/i,
    );
    await expect(chatReadConsent).toContainText(
      /Drive read and app-file access/i,
    );
    await expect(chatReadConsent).toContainText(
      /read-only access to Chat spaces and memberships/i,
    );
    await page.getByText("Connection diagnostics", { exact: true }).click();
    await expect(page.getByTestId("connections-app-policy")).toBeVisible();
    await expect(page.getByTestId("conn-card-apollo")).not.toContainText(
      /Blocked by the organization connected-app policy/i,
    );
    await expect(page.getByTestId("conn-card-hunter")).toHaveCount(0);
    await expect(page.getByTestId("conn-gw-redirect")).toContainText(
      "/api/integrations/google-workspace/callback",
    );

    const banner = page.getByTestId("connections-oauth-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText(/Google Workspace connect failed/i);
    await expect(banner).toContainText(/access_denied/);

    const cards = page.locator("[data-testid^='conn-card-']");
    await expect(cards.first()).toHaveAttribute(
      "data-testid",
      "conn-card-google_workspace",
    );

    await expect(page.getByText(/Live demo blockers/i)).toHaveCount(0);
    await expect(
      page.getByTestId("connections-blocker-link-apollo"),
    ).toHaveCount(0);

    await page.goto(
      "/settings/connections?gw=connected&account=developer%40hrmny.co",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("connections-oauth-banner")).toContainText(
      /Google Workspace connected/i,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("connections-oauth-banner")).toContainText(
      "developer@hrmny.co",
    );
  });

  test("Chat read permission request carries the opt-in intent without opening Google", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    let requestedIntent: string | null = null;
    await page.route(
      "**/api/trpc/connections.startGoogleWorkspaceOAuth**",
      async (route) => {
        const url = new URL(route.request().url());
        const input =
          route.request().postData() ?? url.searchParams.get("input") ?? "";
        requestedIntent = input.includes("google_chat_read")
          ? "google_chat_read"
          : null;
        const redirectUrl = new URL(
          "/__test-google-chat-consent",
          route.request().url(),
        ).toString();
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  json: {
                    redirectUrl,
                    redirectUri:
                      "http://localhost:3000/api/integrations/google-workspace/callback",
                  },
                },
              },
            },
          ]),
        });
      },
    );
    await page.route("**/__test-google-chat-consent", (route) =>
      route.fulfill({ contentType: "text/html", body: "consent mock" }),
    );
    await page.route("**/api/trpc/**", async (route) => {
      const url = new URL(route.request().url());
      const names = decodeURIComponent(
        url.pathname.split("/api/trpc/")[1]!,
      ).split(",");
      const listIndex = names.indexOf("connections.list");
      if (listIndex < 0) return route.fallback();

      const response = await route.fetch();
      const results = await response.json();
      const list = results[listIndex]?.result?.data?.json;
      if (Array.isArray(list)) {
        const googleWorkspace = list.find(
          (item) => item?.toolkit === "google_workspace",
        );
        if (googleWorkspace) {
          googleWorkspace.ready = true;
          googleWorkspace.allowed = true;
        }
      }
      await route.fulfill({ response, status: 200, json: results });
    });
    await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
    const button = page
      .getByTestId("conn-google-chat-read-consent")
      .getByRole("button", { name: /Add Google Chat to Google Workspace/i });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page).toHaveURL(/__test-google-chat-consent/);
    expect(requestedIntent).toBe("google_chat_read");
  });

  test("pasting an n8n key saves through the backend", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
    await page.getByText("Connection diagnostics", { exact: true }).click();
    await expect(page.getByTestId("connections-backend-store")).toBeVisible({
      timeout: 30_000,
    });
    const n8n = page.getByTestId("conn-card-n8n");
    await expect(n8n).toBeVisible({ timeout: 30_000 });
    await n8n.locator('input[type="password"]').fill("n8n-e2e-backend-key");
    await n8n.getByRole("button", { name: /^Connect$/i }).click();
    await expect(page.getByTestId("conn-key-note-n8n")).toContainText(
      /connected/i,
      { timeout: 20_000 },
    );
  });

  test("HITL and Hunt deep-link to the mailbox card", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/outreach", { waitUntil: "domcontentloaded" });
    await page.getByText("Sending setup", { exact: true }).click();
    const gw = page.getByTestId("outreach-ready-gw");
    await expect(gw).toBeVisible({ timeout: 30_000 });
    const reconnect = gw.getByRole("link", {
      name: /Reconnect in Connections/i,
    });
    if ((await reconnect.count()) > 0) {
      await expect(reconnect).toHaveAttribute(
        "href",
        "/settings/connections#conn-google_workspace",
      );
    }

    await page.goto("/crm/settings/sales-os", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("sales-os-settings")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("sales-os-connection-diagnostics").click();
    await expect(
      page.getByRole("link", { name: /Google Workspace/i }).first(),
    ).toHaveAttribute("href", "/settings/connections#conn-google_workspace");

    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hunt-ready-banner")).toBeVisible({
      timeout: 30_000,
    });
    const huntGw = page.getByTestId("hunt-blocker-link-google_workspace");
    if ((await huntGw.count()) > 0) {
      await huntGw.click();
      await expect(page).toHaveURL(/\/settings\/connections/);
      await expect(page.getByTestId("conn-card-google_workspace")).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  test("mailbox hash scrolls after connection cards render", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/connections#conn-google_workspace", {
      waitUntil: "domcontentloaded",
    });
    const card = page.getByTestId("conn-card-google_workspace");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() =>
        card.evaluate((element) => element.getBoundingClientRect().top),
      )
      .toBeLessThan(160);
  });
});
