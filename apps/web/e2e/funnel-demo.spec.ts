import { test, expect } from "@playwright/test";

/**
 * Demo funnel — prospecting → sales → onboarding → creative → portal.
 * Uses x-dev-role (requires AUTH_MODE=dev + ALLOW_DEV_AUTH in CI prod server).
 */
test.describe("Demo funnel", () => {
  test.setTimeout(180_000);

  test("staff path: CRM → clients → creative → delivery → AI", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });

    await page.goto("/crm", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/CRM|deal|pipeline/i);

    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/hunt|apollo|closed loop/i);

    await page.goto("/crm/deals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await page.goto("/crm/inbound", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/inbound|lead|prospect/i);

    await page.goto("/crm/outreach", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/outreach|draft|queue/i);

    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/client/i);

    await page.goto("/creative", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^Creative$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pass QC/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate image/i })).toBeVisible();

    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible();
    await expect(page.locator("body")).toContainText(/Run agent on task/i);

    await page.goto("/settings/ai", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/AI|agent/i);

    await page.goto("/settings/connections", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/connection|composio|apollo/i);

    await page.goto("/settings/automations", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Automations/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Run n8n smoke/i })).toBeVisible();
  });

  test("portal path: client workspace loads for portal_a", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "portal_a" });

    await page.goto("/portal", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/workspace|brief|approval/i);
    await expect(page.url()).not.toContain("/portal/login");

    await page.goto("/portal/approvals", { waitUntil: "domcontentloaded" });
    await expect(page.url()).not.toContain("/portal/login");

    await page.goto("/portal/onboarding", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Onboarding/i })).toBeVisible();
  });

  test("deal detail exposes won + handover controls", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/deals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    const firstDeal = page.locator('a[href^="/crm/deals/"]').first();
    if (await firstDeal.count()) {
      await firstDeal.click();
      await expect(page.locator("body")).toContainText(/BUAF|Advance|Mark won|Handover|Commercial/i);
    }
  });

  test("outreach and approvals honor ?id= deep links", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/outreach?id=demo-focus", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/outreach|draft|queue/i);

    await page.goto("/approvals?id=demo-focus", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("body")).toContainText(/approval|inbox|HITL/i);
  });

  test("client onboarding shows continue OS links", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/clients", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    const firstClient = page.locator('a[href^="/clients/"]').first();
    if (await firstClient.count()) {
      await firstClient.click();
      await expect(
        page.getByRole("navigation", { name: "Continue OS after handover" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("link", { name: /Account calendar/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Creative/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Finance/i })).toBeVisible();
    }
  });

  test("finance honors ?invoiceId= deep link", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/finance?invoiceId=demo-inv", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/finance|invoice|xero/i);
  });

  test("staff can mint distinct portal vs onboarding magic links", async ({
    request,
  }) => {
    // CI e2e has no DATABASE_URL for durable handover; mint via reviewHref instead.
    const clientId = "c1000000-0000-4000-8000-0000000000a4";
    const headers = {
      "x-dev-role": "partner",
      "content-type": "application/json",
    };

    async function mint(next: string) {
      const res = await request.post(
        "/api/trpc/clients.portalUsers.reviewHref",
        {
          headers,
          data: { json: { clientId, next } },
        },
      );
      const text = await res.text();
      expect(res.ok(), text).toBeTruthy();
      const body = JSON.parse(text) as {
        result?: {
          data?:
            | { json?: { portalPath?: string }; portalPath?: string }
            | { portalPath?: string };
        };
        error?: unknown;
      };
      expect(body.error, text).toBeFalsy();
      const data = body.result?.data as
        | { json?: { portalPath?: string }; portalPath?: string }
        | undefined;
      const portalPath = data?.json?.portalPath ?? data?.portalPath;
      expect(portalPath, text).toBeTruthy();
      return portalPath!;
    }

    const portalHref = await mint("/portal/approvals");
    const onboardingHref = await mint("/portal/onboarding");

    expect(portalHref).toMatch(/\/portal\/login\/verify/);
    expect(onboardingHref).toMatch(/\/portal\/login\/verify/);
    expect(portalHref).toContain(encodeURIComponent("/portal/approvals"));
    expect(onboardingHref).toContain(encodeURIComponent("/portal/onboarding"));
    expect(portalHref).not.toBe(onboardingHref);

    const portalToken = new URL(portalHref, "http://localhost").searchParams.get(
      "token",
    );
    const onboardingToken = new URL(
      onboardingHref,
      "http://localhost",
    ).searchParams.get("token");
    expect(portalToken).toBeTruthy();
    expect(onboardingToken).toBeTruthy();
    expect(portalToken).not.toBe(onboardingToken);
  });

  test("delivery Client portal CTA requires a selected task", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });
    const portalCta = page.getByTestId("delivery-client-portal");
    await expect(portalCta).toBeVisible();
    await expect(portalCta).toBeDisabled();
  });

  test("delivery Client portal mints magic link into portal approvals", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });

    const taskSelect = page.getByTestId("delivery-task-select");
    await expect(taskSelect).toBeVisible();
    await expect
      .poll(async () => taskSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);

    await taskSelect.selectOption({ index: 1 });
    const portalCta = page.getByTestId("delivery-client-portal");
    await expect(portalCta).toBeEnabled();
    await portalCta.click();

    await expect(page).toHaveURL(/\/portal\/login\/verify/, {
      timeout: 60_000,
    });
    await expect(page).toHaveURL(/token=/);

    // Verify consumes the token and lands on portal Approvals (default next).
    await expect(
      page.getByRole("heading", { name: /^Approvals$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/portal\/approvals/);
  });

  test("delivery Run agent uses seeded Delivery coach on a task", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/delivery", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Delivery/i })).toBeVisible({
      timeout: 60_000,
    });

    const taskSelect = page.getByTestId("delivery-task-select");
    await expect
      .poll(async () => taskSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);
    await taskSelect.selectOption({ index: 1 });

    const agentSelect = page.getByTestId("delivery-agent-select");
    await expect
      .poll(async () => agentSelect.locator("option").count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(1);
    // Prefer the seeded Delivery coach when present.
    const coachOption = agentSelect.locator("option").filter({
      hasText: "Delivery coach",
    });
    if ((await coachOption.count()) > 0) {
      const value = await coachOption.first().getAttribute("value");
      expect(value).toBeTruthy();
      await agentSelect.selectOption(value!);
    } else {
      await agentSelect.selectOption({ index: 1 });
    }

    const prompt = page.getByTestId("delivery-agent-prompt");
    await prompt.fill("E2E: what is the next delivery step for this task?");
    const run = page.getByTestId("delivery-run-agent");
    await expect(run).toBeEnabled();
    await run.click();

    const output = page.getByTestId("delivery-agent-output");
    await expect(output).toBeVisible({ timeout: 60_000 });
    await expect(output).not.toHaveText("");
  });

  test("portal reject lands in partner /notifications inbox", async ({
    page,
    request,
  }) => {
    const portalHeaders = {
      "x-dev-role": "portal_a",
      "content-type": "application/json",
    };

    // Memory-mode demo store seeds a pending Demo Co approval on first use.
    const list = await request.get("/api/trpc/portal.approvals.list", {
      headers: portalHeaders,
    });
    const listText = await list.text();
    expect(list.ok(), listText).toBeTruthy();
    const listBody = JSON.parse(listText) as {
      result?: { data?: { json?: Array<{ approvalId: string; status: string; title: string }> } };
    };
    const approvals =
      listBody.result?.data?.json ??
      (listBody.result?.data as unknown as Array<{
        approvalId: string;
        status: string;
        title: string;
      }>) ??
      [];
    const pending = (Array.isArray(approvals) ? approvals : []).find(
      (a) => a.status === "pending",
    );
    expect(pending, listText).toBeTruthy();

    const act = await request.post("/api/trpc/portal.approvals.act", {
      headers: portalHeaders,
      data: {
        json: {
          id: pending!.approvalId,
          action: "reject",
          feedback: "E2E: tighten the hook",
        },
      },
    });
    const actText = await act.text();
    expect(act.ok(), actText).toBeTruthy();
    expect(actText).not.toMatch(/"error"/);

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("body")).toContainText(/Client revisions/i);
    await expect(page.locator("body")).toContainText(pending!.title);
    await expect(page.locator("body")).toContainText(/E2E: tighten the hook/i);

    // Open must deep-link into Creative with the revised task focused.
    const openLink = page.locator('a[href*="/creative?"][href*="taskId="]');
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute("href", /taskId=/);
    await openLink.click();
    await expect(
      page.getByRole("heading", { name: /^Creative$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/creative\?.*taskId=/);
    await expect(page.getByTestId("creative-task-meta")).toContainText(
      /status=revisions/,
    );
    await expect(page.getByTestId("creative-revisions-banner")).toContainText(
      /Client requested revisions/i,
    );
    await expect(page.getByTestId("creative-task-meta")).toContainText(
      /clientRevisions=[1-9]/,
    );
  });

  test("portal onboarding acknowledge lands in partner /notifications", async ({
    page,
    request,
  }) => {
    const portalHeaders = {
      "x-dev-role": "portal_a",
      "content-type": "application/json",
    };

    const board = await request.get("/api/trpc/portal.onboarding.get", {
      headers: portalHeaders,
    });
    const boardText = await board.text();
    expect(board.ok(), boardText).toBeTruthy();
    const boardBody = JSON.parse(boardText) as {
      result?: {
        data?: {
          json?: {
            phases?: Array<{ phaseIndex: number; name: string; status: string }>;
          };
        };
      };
    };
    const phases =
      boardBody.result?.data?.json?.phases ??
      (
        boardBody.result?.data as unknown as {
          phases?: Array<{ phaseIndex: number; name: string; status: string }>;
        }
      )?.phases ??
      [];
    const active = (Array.isArray(phases) ? phases : []).find(
      (p) => p.status === "active",
    );
    expect(active, boardText).toBeTruthy();

    const ack = await request.post("/api/trpc/portal.onboarding.acknowledge", {
      headers: portalHeaders,
      data: {
        json: { phaseIndex: active!.phaseIndex },
      },
    });
    const ackText = await ack.text();
    expect(ack.ok(), ackText).toBeTruthy();
    expect(ackText).not.toMatch(/"error"/);

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("body")).toContainText(/Onboarding signed off/i);
    await expect(page.locator("body")).toContainText(active!.name);
    const open = page.getByRole("link", { name: /^Open$/i }).first();
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", /\?phase=\d+/);
  });

  test("portal campaign reject lands in partner inbox and Approvals deep-link", async ({
    page,
    request,
  }) => {
    const portalHeaders = {
      "x-dev-role": "portal_a",
      "content-type": "application/json",
    };

    // Memory campaign seed: two Demo Co drafts awaiting client sign-off.
    const list = await request.get("/api/trpc/portal.campaignApprovals.list", {
      headers: portalHeaders,
    });
    const listText = await list.text();
    expect(list.ok(), listText).toBeTruthy();
    const listBody = JSON.parse(listText) as {
      result?: {
        data?: {
          json?: Array<{
            campaignItemId: string;
            title: string;
            state: string;
          }>;
        };
      };
    };
    const items =
      listBody.result?.data?.json ??
      (listBody.result?.data as unknown as Array<{
        campaignItemId: string;
        title: string;
        state: string;
      }>) ??
      [];
    const pending = (Array.isArray(items) ? items : []).find(
      (i) => i.state === "pending_client",
    );
    expect(pending, listText).toBeTruthy();

    const reject = await request.post(
      "/api/trpc/portal.campaignApprovals.reject",
      {
        headers: portalHeaders,
        data: {
          json: {
            id: pending!.campaignItemId,
            feedback: "E2E: lead with the offer",
          },
        },
      },
    );
    const rejectText = await reject.text();
    expect(reject.ok(), rejectText).toBeTruthy();
    expect(rejectText).not.toMatch(/"error"/);

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("body")).toContainText(
      /Client campaign revisions/i,
    );
    await expect(page.locator("body")).toContainText(pending!.title);
    await expect(page.locator("body")).toContainText(
      /E2E: lead with the offer/i,
    );
    const idEsc = pending!.campaignItemId.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    // Match by href so earlier funnel notifies don't steal the click.
    const openLink = page.locator(
      `a[href*="/approvals?id=${pending!.campaignItemId}"]`,
    );
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute(
      "href",
      new RegExp(`/approvals\\?id=${idEsc}`),
    );

    await openLink.click();
    await expect(
      page.getByRole("heading", { name: /Approval inbox/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`id=${idEsc}`));
    await expect(page.locator("body")).toContainText(pending!.title);
    await expect(page.locator("body")).toContainText(
      /Client requested changes/i,
    );
    await expect(page.locator("body")).toContainText(
      /E2E: lead with the offer/i,
    );
  });

});
