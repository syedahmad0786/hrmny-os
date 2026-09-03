import { expect, test } from "@playwright/test";

/**
 * Canva stub → portal attach on /creative (mock-safe, no live Canva).
 * Ensures stub OAuth connect when memory mode requires it, then attaches a
 * stub design into portal client_review — distinct from image-gen→portal.
 *
 * Do NOT call m4.reset — clears portal approvals + Client B and breaks later
 * funnel-demo portal/isolation e2es.
 */
test.describe("Creative Canva stub → portal UI", () => {
  test("stub list attach opens portal review", async ({ page, request }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });

    const listBefore = await request.get(
      "/api/trpc/connections.canvaListDesigns",
      { headers: { "x-dev-role": "partner" } },
    );
    const listBeforeText = await listBefore.text();
    expect(listBefore.ok(), listBeforeText).toBeTruthy();

    // Memory mode without COMPOSIO needs Connect canva before stub list.
    // COMPOSIO without a Canva account already returns stub designs.
    let listOk = false;
    try {
      const parsed = JSON.parse(listBeforeText) as {
        result?: { data?: { json?: { ok?: boolean }; ok?: boolean } };
      };
      listOk =
        parsed.result?.data?.json?.ok === true ||
        parsed.result?.data?.ok === true;
    } catch {
      listOk = /"ok"\s*:\s*true/.test(listBeforeText);
    }

    if (!listOk) {
      const start = await request.post("/api/trpc/connections.startOAuth", {
        headers: {
          "x-dev-role": "partner",
          "content-type": "application/json",
        },
        data: { json: { toolkit: "canva" } },
      });
      expect(start.ok(), await start.text()).toBeTruthy();
      const done = await request.post("/api/trpc/connections.completeOAuth", {
        headers: {
          "x-dev-role": "partner",
          "content-type": "application/json",
        },
        data: { json: { toolkit: "canva" } },
      });
      expect(done.ok(), await done.text()).toBeTruthy();
    }

    await page.goto("/creative", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /^Creative$/i }),
    ).toBeVisible({ timeout: 60_000 });

    const clientSelect = page.getByTestId("creative-portal-client");
    await expect(clientSelect).toBeVisible();
    await expect
      .poll(async () => clientSelect.locator("option").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(1);
    const current = await clientSelect.inputValue();
    if (!current) {
      await clientSelect.selectOption({ label: /Demo Co/i });
    }
    await expect
      .poll(async () => clientSelect.inputValue(), { timeout: 15_000 })
      .not.toBe("");

    await expect(page.getByTestId("canva-list-mode")).toContainText(/stub/i, {
      timeout: 30_000,
    });

    const attach = page.getByTestId("canva-attach-stub-design-1");
    await expect(attach).toBeVisible({ timeout: 30_000 });
    await expect(attach).toBeEnabled();
    await attach.click();

    await expect(page.getByTestId("creative-qc-msg")).toContainText(
      /Canva → portal|asset/i,
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("creative-portal-review")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("creative-portal-review").locator("a"),
    ).toHaveAttribute("href", /\/client-preview\?client=.*#approvals/);

    const approvals = await request.get("/api/trpc/portal.approvals.list", {
      headers: {
        "x-dev-role": "portal_a",
        "content-type": "application/json",
      },
    });
    const approvalsText = await approvals.text();
    expect(approvals.ok(), approvalsText).toBeTruthy();
    expect(approvalsText).toMatch(/pending|Canva|Brand kit|stub|Creative/i);
  });
});
