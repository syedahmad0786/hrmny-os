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

    // Memory-mode prospect → won → onboarding (no DATABASE_URL in CI).
    const runLoop = page.getByRole("button", { name: /Run demo closed loop/i });
    await expect(runLoop).toBeVisible();
    await runLoop.click();
    const status = page.getByTestId("hunt-closed-loop-status");
    await expect(status).toBeVisible({ timeout: 60_000 });
    await expect(status).toContainText(/Closed loop ready/i);
    const clientLink = status.getByRole("link", { name: /Client onboarding/i });
    await expect(clientLink).toBeVisible();
    await clientLink.click();
    await expect(page).toHaveURL(/\/clients\//);
    await expect(
      page.getByRole("navigation", { name: /Continue OS after handover/i }),
    ).toBeVisible({ timeout: 30_000 });

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

    // Memory-mode demo store seeds pending Demo Co approvals (reject + approve isolated).
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
      (a) =>
        a.status === "pending" && /Approve launch reel cut/i.test(a.title),
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
    const rejectRow = page
      .locator("li")
      .filter({ hasText: /Client revisions/i })
      .filter({ hasText: pending!.title });
    await expect(rejectRow).toBeVisible();
    await expect(rejectRow).toContainText(/E2E: tighten the hook/i);

    // Open must deep-link into Creative with the revised task focused.
    const openLink = rejectRow.locator(
      'a[href*="/creative?"][href*="taskId="]',
    );
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

  test("portal approve lands in partner inbox and Creative deep-link", async ({
    page,
    request,
  }) => {
    const portalHeaders = {
      "x-dev-role": "portal_a",
      "content-type": "application/json",
    };

    const list = await request.get("/api/trpc/portal.approvals.list", {
      headers: portalHeaders,
    });
    const listText = await list.text();
    expect(list.ok(), listText).toBeTruthy();
    const listBody = JSON.parse(listText) as {
      result?: {
        data?: {
          json?: Array<{ approvalId: string; status: string; title: string }>;
        };
      };
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
      (a) =>
        a.status === "pending" &&
        /Approve product stills pack/i.test(a.title),
    );
    expect(pending, listText).toBeTruthy();

    const act = await request.post("/api/trpc/portal.approvals.act", {
      headers: portalHeaders,
      data: {
        json: {
          id: pending!.approvalId,
          action: "approve",
          feedback: "E2E: ship it",
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
    const approveRow = page
      .locator("li")
      .filter({ hasText: /Client approved/i })
      .filter({ hasText: pending!.title });
    await expect(approveRow).toBeVisible();
    await expect(approveRow).toContainText(/E2E: ship it/i);

    const openLink = approveRow.locator(
      'a[href*="/creative?"][href*="taskId="]',
    );
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute("href", /taskId=/);
    await openLink.click();
    await expect(
      page.getByRole("heading", { name: /^Creative$/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/creative\?.*taskId=/);
    await expect(page.getByTestId("creative-task-meta")).toContainText(
      /status=approved/,
    );
    await expect(page.getByTestId("creative-approved-banner")).toContainText(
      /Client approved/i,
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
    const onboardRow = page
      .locator("li")
      .filter({ hasText: /Onboarding signed off/i })
      .filter({ hasText: active!.name });
    await expect(onboardRow).toBeVisible();
    const open = onboardRow.getByRole("link", { name: /^Open$/i });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", /\?phase=\d+/);
    await open.click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/.+\\?phase=${active!.phaseIndex}`),
    );
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toBeVisible({ timeout: 60_000 });
    const focused = page.getByTestId("onboarding-phase-focus");
    await expect(focused).toBeVisible();
    await expect(focused).toHaveAttribute(
      "id",
      `onboarding-phase-${active!.phaseIndex}`,
    );
    await expect(focused).toContainText(active!.name);
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
      (i) =>
        i.state === "pending_client" &&
        /Ramadan teaser/i.test(i.title),
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

  test("portal campaign approve lands in partner inbox and Approvals deep-link", async ({
    page,
    request,
  }) => {
    const portalHeaders = {
      "x-dev-role": "portal_a",
      "content-type": "application/json",
    };

    // Second Demo Co seed ("Product launch reel") — isolated from reject e2e.
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
      (i) =>
        i.state === "pending_client" &&
        /Product launch reel/i.test(i.title),
    );
    expect(pending, listText).toBeTruthy();

    const approve = await request.post(
      "/api/trpc/portal.campaignApprovals.approve",
      {
        headers: portalHeaders,
        data: {
          json: {
            id: pending!.campaignItemId,
          },
        },
      },
    );
    const approveText = await approve.text();
    expect(approve.ok(), approveText).toBeTruthy();
    expect(approveText).not.toMatch(/"error"/);

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Notifications/i }),
    ).toBeVisible({ timeout: 60_000 });
    const approveRow = page
      .locator("li")
      .filter({ hasText: /Client approved campaign/i })
      .filter({ hasText: pending!.title });
    await expect(approveRow).toBeVisible();
    const idEsc = pending!.campaignItemId.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const openLink = approveRow.locator(
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
      /approved and ready to publish/i,
    );
  });

  test("portal_a and portal_b sandboxes stay isolated", async ({ request }) => {
    const parseList = async (path: string, role: string) => {
      const res = await request.get(path, {
        headers: {
          "x-dev-role": role,
          "content-type": "application/json",
        },
      });
      const text = await res.text();
      expect(res.ok(), `${role} ${path}: ${text}`).toBeTruthy();
      const body = JSON.parse(text) as {
        result?: { data?: { json?: unknown } };
      };
      return {
        text,
        data:
          body.result?.data?.json ??
          (body.result?.data as unknown) ??
          null,
      };
    };

    const aTasks = await parseList("/api/trpc/portal.tasks.list", "portal_a");
    const aAssets = await parseList("/api/trpc/portal.assets.list", "portal_a");
    const aApprovals = await parseList(
      "/api/trpc/portal.approvals.list",
      "portal_a",
    );
    const bTasks = await parseList("/api/trpc/portal.tasks.list", "portal_b");
    const bAssets = await parseList("/api/trpc/portal.assets.list", "portal_b");
    const bApprovals = await parseList(
      "/api/trpc/portal.approvals.list",
      "portal_b",
    );

    const blob = (value: unknown) => JSON.stringify(value ?? {});

    expect(blob(aTasks.data)).toMatch(/Launch reel|Demo Co|Approve launch/i);
    expect(blob(aTasks.data)).not.toMatch(/Other Co/i);
    expect(blob(aAssets.data)).not.toMatch(/Other Co/i);
    expect(blob(aApprovals.data)).toMatch(/Approve launch reel cut|Approve product stills/i);
    expect(blob(aApprovals.data)).not.toMatch(/Other Co/i);

    expect(blob(bTasks.data)).toMatch(/Other Co/i);
    expect(blob(bTasks.data)).not.toMatch(/Launch reel|Demo Co/i);
    expect(blob(bAssets.data)).toMatch(/Other Co/i);
    expect(blob(bAssets.data)).not.toMatch(/Launch reel|Demo Co/i);
    expect(blob(bApprovals.data)).not.toMatch(
      /Approve launch reel cut|Approve product stills|Demo Co/i,
    );
  });

  test("magic-link session grants isolate client A vs B without x-dev-role", async ({
    request,
  }) => {
    const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";
    const DEMO_CLIENT_B_ID = "c1000000-0000-4000-8000-0000000000b4";
    const staffHeaders = {
      "x-dev-role": "partner",
      "content-type": "application/json",
    };

    async function mintAndVerify(clientId: string, email: string) {
      const mint = await request.post(
        "/api/trpc/clients.portalUsers.issueDemoToken",
        {
          headers: staffHeaders,
          data: { json: { clientId, email } },
        },
      );
      const mintText = await mint.text();
      expect(mint.ok(), mintText).toBeTruthy();
      const mintBody = JSON.parse(mintText) as {
        result?: { data?: { json?: { token?: string }; token?: string } };
      };
      const token =
        mintBody.result?.data?.json?.token ?? mintBody.result?.data?.token;
      expect(token, mintText).toBeTruthy();
      expect(token!.startsWith("ml_")).toBe(true);

      const verify = await request.post("/api/trpc/portal.auth.verify", {
        headers: { "content-type": "application/json" },
        data: { json: { token } },
      });
      const verifyText = await verify.text();
      expect(verify.ok(), verifyText).toBeTruthy();
      const verifyBody = JSON.parse(verifyText) as {
        result?: {
          data?: {
            json?: {
              ok?: boolean;
              clientId?: string;
              sessionGrant?: string;
            };
            ok?: boolean;
            clientId?: string;
            sessionGrant?: string;
          };
        };
      };
      const verified =
        verifyBody.result?.data?.json ?? verifyBody.result?.data ?? {};
      expect(verified.ok, verifyText).toBe(true);
      expect(verified.clientId).toBe(clientId);
      expect(verified.sessionGrant?.startsWith("ps_")).toBe(true);
      return verified.sessionGrant!;
    }

    const grantA = await mintAndVerify(
      DEMO_CLIENT_ID,
      "alex@democo.example",
    );
    const grantB = await mintAndVerify(
      DEMO_CLIENT_B_ID,
      "ops@otherco.example",
    );
    expect(grantA).not.toBe(grantB);

    async function listWithGrant(path: string, grant: string) {
      const res = await request.get(path, {
        headers: {
          "x-portal-grant": grant,
          "content-type": "application/json",
        },
      });
      const text = await res.text();
      expect(res.ok(), `${path}: ${text}`).toBeTruthy();
      // Must not depend on persona headers.
      expect(text).not.toMatch(/x-dev-role/i);
      const body = JSON.parse(text) as {
        result?: { data?: { json?: unknown } };
      };
      return body.result?.data?.json ?? body.result?.data ?? null;
    }

    const aTasks = await listWithGrant(
      "/api/trpc/portal.tasks.list",
      grantA,
    );
    const aAssets = await listWithGrant(
      "/api/trpc/portal.assets.list",
      grantA,
    );
    const aApprovals = await listWithGrant(
      "/api/trpc/portal.approvals.list",
      grantA,
    );
    const bTasks = await listWithGrant(
      "/api/trpc/portal.tasks.list",
      grantB,
    );
    const bAssets = await listWithGrant(
      "/api/trpc/portal.assets.list",
      grantB,
    );
    const bApprovals = await listWithGrant(
      "/api/trpc/portal.approvals.list",
      grantB,
    );

    const blob = (value: unknown) => JSON.stringify(value ?? {});

    expect(blob(aTasks)).toMatch(/Launch reel|Demo Co|Approve launch/i);
    expect(blob(aTasks)).not.toMatch(/Other Co/i);
    expect(blob(aAssets)).not.toMatch(/Other Co/i);
    expect(blob(aApprovals)).toMatch(
      /Approve launch reel cut|Approve product stills/i,
    );
    expect(blob(aApprovals)).not.toMatch(/Other Co/i);

    expect(blob(bTasks)).toMatch(/Other Co/i);
    expect(blob(bTasks)).not.toMatch(/Launch reel|Demo Co/i);
    expect(blob(bAssets)).toMatch(/Other Co/i);
    expect(blob(bAssets)).not.toMatch(/Launch reel|Demo Co/i);
    expect(blob(bApprovals)).not.toMatch(
      /Approve launch reel cut|Approve product stills|Demo Co/i,
    );
  });

  test("creative generate attaches to portal review", async ({
    page,
    request,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/creative", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Creative$/i }),
    ).toBeVisible({ timeout: 60_000 });

    const clientSelect = page.getByTestId("creative-portal-client");
    await expect(clientSelect).toBeVisible();
    // Seed ids auto-select Demo Co; fall back to picking by label.
    await expect
      .poll(async () => clientSelect.inputValue(), { timeout: 30_000 })
      .not.toBe("");
    const selected = await clientSelect.inputValue();
    if (!selected) {
      await clientSelect.selectOption({ label: /Demo Co/i });
    }

    const generate = page.getByTestId("creative-generate");
    await expect(generate).toBeEnabled();
    await generate.click();

    const send = page.getByTestId("creative-send-portal");
    await expect(send).toBeEnabled({ timeout: 60_000 });
    await send.click();

    const portalReview = page.getByTestId("creative-portal-review");
    await expect(portalReview).toBeVisible({ timeout: 60_000 });
    await expect(portalReview.locator("a")).toHaveAttribute(
      "href",
      /\/portal\//,
    );

    // Memory-mode portal should now list the freshly attached pending approval.
    const list = await request.get("/api/trpc/portal.approvals.list", {
      headers: {
        "x-dev-role": "portal_a",
        "content-type": "application/json",
      },
    });
    const listText = await list.text();
    expect(list.ok(), listText).toBeTruthy();
    expect(listText).toMatch(/Creative ·|pending/i);
  });

  test("staff chat threads stay isolated across partner and finance", async ({
    request,
  }) => {
    const title = `E2E partner thread ${Date.now()}`;
    const create = await request.post("/api/trpc/chat.createThread", {
      headers: {
        "x-dev-role": "partner",
        "content-type": "application/json",
      },
      data: { json: { title } },
    });
    const createText = await create.text();
    expect(create.ok(), createText).toBeTruthy();
    const created = JSON.parse(createText) as {
      result?: { data?: { json?: { chatThreadId?: string }; chatThreadId?: string } };
    };
    const threadId =
      created.result?.data?.json?.chatThreadId ??
      created.result?.data?.chatThreadId;
    expect(threadId).toBeTruthy();

    const partnerList = await request.get("/api/trpc/chat.listThreads", {
      headers: { "x-dev-role": "partner" },
    });
    const partnerText = await partnerList.text();
    expect(partnerList.ok(), partnerText).toBeTruthy();
    expect(partnerText).toContain(threadId!);

    const financeList = await request.get("/api/trpc/chat.listThreads", {
      headers: { "x-dev-role": "finance" },
    });
    const financeText = await financeList.text();
    expect(financeList.ok(), financeText).toBeTruthy();
    expect(financeText).not.toContain(threadId!);

    const financeMessages = await request.get(
      `/api/trpc/chat.messages?input=${encodeURIComponent(
        JSON.stringify({ json: { threadId } }),
      )}`,
      { headers: { "x-dev-role": "finance" } },
    );
    const messagesText = await financeMessages.text();
    expect(financeMessages.ok()).toBeFalsy();
    expect(messagesText).toMatch(/NOT_FOUND|not found/i);
  });

  test("settings AI create → run agent on command", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/settings/ai", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /AI control panel/i }),
    ).toBeVisible({ timeout: 60_000 });

    const sandbox = page.getByTestId("ai-sandbox-client");
    await expect(sandbox).toBeVisible();
    await expect
      .poll(async () => sandbox.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await sandbox.selectOption({ label: "Demo Co LLC" });

    const slug = `e2e-coach-${Date.now()}`;
    await page.getByTestId("ai-agent-slug").fill(slug);
    await page.getByTestId("ai-agent-name").fill("E2E Command Coach");
    await page.getByTestId("ai-agent-create").click();

    const row = page.getByTestId(`ai-agent-row-${slug}`);
    await expect(row).toBeVisible({ timeout: 30_000 });

    await page
      .getByTestId("ai-agent-run-prompt")
      .fill("Give one next onboarding action for this client sandbox.");
    await page.getByTestId(`ai-agent-run-${slug}`).click();

    const output = page.getByTestId("ai-agent-run-output");
    await expect(output).toBeVisible({ timeout: 60_000 });
    await expect(output).not.toBeEmpty();
  });

  test("traffic DoR fill≤2 & lock spawns creative task", async ({ page }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "traffic" });
    await page.goto("/traffic", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Traffic · Definition of Ready/i }),
    ).toBeVisible({ timeout: 60_000 });

    const briefId = page.getByTestId("traffic-brief-id");
    await expect(briefId).toBeVisible();
    await expect
      .poll(async () => briefId.textContent(), { timeout: 30_000 })
      .toMatch(/d1000000/i);

    const missing = page.getByTestId("traffic-dor-missing");
    await expect(missing).toBeVisible();
    // Seed starts with >2 missing required fields.
    await expect
      .poll(async () => missing.textContent(), { timeout: 30_000 })
      .toMatch(/Missing:\s*[3-9]/);

    await page.getByTestId("traffic-fill-lock").click();

    const status = page.getByTestId("traffic-lock-status");
    await expect(status).toBeVisible({ timeout: 60_000 });
    await expect(status).toContainText(/Locked → taskStatus=brief_ready/i);

    const spawn = page.getByTestId("traffic-spawn-result");
    await expect(spawn).toBeVisible();
    await expect(spawn).toContainText(/Spawned creative task/i);

    const link = page.getByTestId("traffic-creative-task-link");
    await expect(link).toHaveAttribute("href", /\/creative\?taskId=/);
    await link.click();
    await expect(page).toHaveURL(/\/creative\?taskId=/);
    await expect(
      page.getByRole("heading", { name: /^Creative$/i }),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("chat Demo Co sandbox runs funnel_act via starter (mock-safe)", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /What should Hrmny work on|New conversation|Chat/i }),
    ).toBeVisible({ timeout: 60_000 });

    const sandbox = page.getByTestId("chat-sandbox-client");
    await expect(sandbox).toBeVisible();
    await expect
      .poll(async () => sandbox.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);

    // Org scope hides the funnel starter (requires client sandbox).
    await sandbox.selectOption({ label: "Staff / org scope" });
    await expect(page.getByTestId("chat-starter-funnel")).toHaveCount(0);

    await sandbox.selectOption({ label: "Demo Co LLC" });
    await page.getByTestId("chat-new").click();
    await expect(page.getByTestId("chat-starter-funnel")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("chat-starter-funnel").click();

    const work = page.getByTestId("chat-work-steps");
    await expect(work).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("chat-tool-funnel_act")).toBeVisible();
    const observation = page.getByTestId("chat-tool-observation");
    await expect(observation).toContainText(/tasks\.create|creative\.sendToPortal/i);
    await expect(observation).toContainText(/\/portal\/login\/verify\?token=/);
    await expect(page.getByTestId("chat-assistant-message")).toContainText(
      /funnel|portal/i,
    );
  });

});
