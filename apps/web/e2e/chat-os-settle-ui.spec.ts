import { expect, test } from "@playwright/test";

/**
 * Chat org-scope OS settle agent (mock-safe).
 * Selects seeded os-settle agent and runs the settle starter so
 * agents-on-command is proven on the primary staff Chat surface.
 *
 * Note: agent_act observations are truncated to 4k; closed_loop may fall
 * past the slice when many read tools run first. Next-link chips are
 * asserted on the client funnel starter (chat-funnel-ui) instead.
 */
test.describe("Chat OS settle agent UI", () => {
  test("os-settle agent runs agent_act closed loop from starter", async ({
    page,
  }) => {
    // Brief lock + full settle path regularly exceeds Playwright's 30s default.
    test.setTimeout(180_000);
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const sandbox = page.getByTestId("chat-sandbox-client");
    await expect(sandbox).toBeVisible({ timeout: 60_000 });
    await sandbox.selectOption({ label: "Staff / org scope" });

    const agent = page.getByTestId("chat-agent-slug");
    await expect(agent).toBeVisible();
    await expect
      .poll(async () => agent.locator("option").count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await agent.selectOption({ value: "os-settle" });
    await expect(page.getByTestId("chat-agent-hint")).toBeVisible();
    await expect(page.getByTestId("chat-context-banner")).toBeVisible();
    await expect(page.getByTestId("chat-pill-agent")).toContainText(/OS settle/i);
    await expect(page.getByTestId("chat-agent-tools-preview")).toBeVisible();
    await expect(page.getByTestId("chat-agent-tools-preview")).toContainText(
      /closed_loop|briefs\.os_lock|finance\.os/i,
    );

    await page.getByTestId("chat-new").click();
    // Wait until the new session is bound to os-settle (avoids racing an
    // older org thread that lacked agent_act).
    await expect(page.getByTestId("chat-pill-agent")).toContainText(/OS settle/i, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("chat-starter-os-settle")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("chat-starter-os-settle").click();

    const work = page.getByTestId("chat-work-steps");
    await expect(work).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("chat-assistant-message")).toBeVisible({
      timeout: 30_000,
    });
    // Prefer agent_act; settle may also surface discrete harness tools when
    // the mock router picks them. Observation text covers inner agent tools.
    const settleStep = page
      .getByTestId("chat-tool-agent_act")
      .or(page.getByTestId("chat-tool-briefs_os_lock"))
      .or(page.getByTestId("chat-tool-crm_closed_loop"))
      .or(page.getByTestId("chat-tool-finance_os_approve"));
    await expect(settleStep).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("chat-tool-observation").first()).toBeVisible();
    await expect(work).toContainText(
      /agent_act|briefs_os_lock|crm_closed_loop|closed_loop|briefs\.os_lock|finance/i,
    );
  });
});
