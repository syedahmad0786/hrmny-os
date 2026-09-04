import { expect, test } from "@playwright/test";

const PARTNER_EMPLOYEE_ID = "c0000000-0000-4000-8000-000000000001";
const AM_EMPLOYEE_ID = "c0000000-0000-4000-8000-000000000002";
const APOLLO_SEARCH_SESSION_KEY = "hrmny.apollo-search.pending.v2";
const LEGACY_APOLLO_SEARCH_SESSION_KEY = "hrmny.apollo-search.pending.v1";

function completedSearchResponse(fullName: string) {
  return JSON.stringify([
    {
      result: {
        data: {
          json: {
            receiptId: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
            mode: "mock",
            status: "completed",
            attempts: 1,
            candidates: [
              {
                externalId: "synthetic-completed-person",
                fullName,
                title: "Private Search Result",
                companyName: "Principal Scoped Result",
                source: "apollo",
              },
            ],
          },
        },
      },
    },
  ]);
}

function savedCandidateResponse() {
  return JSON.stringify([
    {
      result: {
        data: {
          json: {
            dealId: "e2000000-0000-4000-8000-000000000001",
            companyId: "c2000000-0000-4000-8000-000000000001",
            companyName: "Principal Scoped Result",
            duplicate: false,
          },
        },
      },
    },
  ]);
}

/** Explicit synthetic acceptance fixtures; the normal Apollo surface remains
 * disconnected and fail-closed without a live, scoped provider credential. */
test.describe("Hunt Apollo prospect UI", () => {
  test("synthetic Apollo fixture imports discover deal and opens detail", async ({
    page,
  }) => {
    const query = `E2E Apollo Retail ${Date.now()}`;

    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("hunt-apollo-query")).toBeDisabled();

    await page.getByTestId("hunt-test-tools").click();
    await expect(page.getByTestId("hunt-apollo-prospect")).toBeDisabled();
    await page.getByTestId("hunt-synthetic-company").fill(query);
    await expect(page.getByTestId("hunt-apollo-prospect")).toBeEnabled();
    await page.getByTestId("hunt-apollo-prospect").click();

    const status = page.getByTestId("hunt-closed-loop-status");
    await expect(status).toContainText(/Apollo \(mock/i, { timeout: 30_000 });
    await expect(status).toContainText(/discover deal/i);

    const open = page.getByTestId("hunt-apollo-open-deal");
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute("href", /\/crm\/deals\//);
    await open.click();

    await expect(page).toHaveURL(/\/crm\/deals\/[0-9a-f-]{36}/i, {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator("body")).toContainText(/New lead/i);
    await expect(page.locator("body")).toContainText(/apollo/i);
    await expect(page.locator("body")).toContainText(/Work email/i);
  });

  test("free people search fails closed when Apollo is not connected", async ({
    page,
  }) => {
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    const search = page.getByTestId("hunt-apollo-search");
    await expect(search).toBeDisabled({ timeout: 60_000 });
    await expect(search).toHaveText(/Connect Apollo to search/i);
    await expect(page.getByTestId("hunt-apollo-results")).toHaveCount(0);
  });

  test("ignores a global Apollo key when this employee has no connection", async ({
    page,
  }) => {
    await page.route("**/api/ready", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        tools: Record<string, unknown>;
      };
      await route.fulfill({
        response,
        json: { ...body, tools: { ...body.tools, apollo: "configured" } },
      });
    });
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("hunt-ready-banner")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("hunt-apollo-credential")).toHaveText(
      "Not connected",
    );
    await expect(page.getByTestId("hunt-apollo-search")).toBeDisabled();
    await expect(page.getByTestId("hunt-apollo-search")).toHaveText(
      /Connect Apollo to search/i,
    );
  });

  test("restores the same pending request identity after a reload", async ({
    page,
  }) => {
    const idempotencyKey = "51000000-0000-4000-8000-000000000001";
    await page.addInitScript(
      ({ key, value }) => window.sessionStorage.setItem(key, value),
      {
        key: APOLLO_SEARCH_SESSION_KEY,
        value: JSON.stringify({
          version: 2,
          principalId: PARTNER_EMPLOYEE_ID,
          idempotencyKey,
          titles: ["Marketing Director"],
          perPage: 8,
        }),
      },
    );
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("hunt-apollo-search-status")).toContainText(
      /same request ID/i,
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("hunt-apollo-title")).toHaveValue(
      "Marketing Director",
    );
    await expect(page.getByTestId("hunt-apollo-search")).toBeDisabled();
    await expect(
      page.getByTestId("hunt-apollo-retry-same-search"),
    ).toBeVisible();
    await expect(
      page.getByTestId("hunt-apollo-retry-same-search"),
    ).toHaveAttribute("data-request-id", idempotencyKey);
    await expect(page.getByTestId("hunt-apollo-cancel-search")).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hunt-apollo-search-status")).toContainText(
      /same request ID/i,
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("hunt-apollo-title")).toHaveValue(
      "Marketing Director",
    );
    await expect(page.getByTestId("hunt-apollo-search")).toBeDisabled();
    await expect(
      page.getByTestId("hunt-apollo-retry-same-search"),
    ).toHaveAttribute("data-request-id", idempotencyKey);
    await expect
      .poll(() =>
        page.evaluate(
          (key) =>
            JSON.parse(window.sessionStorage.getItem(key) ?? "{}")
              .idempotencyKey,
          APOLLO_SEARCH_SESSION_KEY,
        ),
      )
      .toBe(idempotencyKey);
  });

  test("restores the latest durable search in a fresh browser session", async ({
    page,
  }) => {
    const idempotencyKey = "51000000-0000-4000-8000-000000000002";
    const restoredCandidate = "RESTORED SERVER CANDIDATE";
    let providerSearchCalls = 0;
    await page.route("**/api/trpc/**", async (route) => {
      const procedurePath = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/api/trpc/")[1] ?? "",
      );
      const procedures = procedurePath.split(",");
      if (procedures.includes("salesOs.apollo.search")) {
        providerSearchCalls += 1;
      }
      const latestIndex = procedures.indexOf("salesOs.apollo.latestSearch");
      const statusIndex = procedures.indexOf("salesOs.apollo.searchStatus");
      if (latestIndex < 0 && statusIndex < 0) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as Array<unknown>;
      const result = JSON.parse(completedSearchResponse(restoredCandidate))[0];
      if (latestIndex >= 0) {
        body[latestIndex] = {
          result: {
            data: {
              json: {
                search: {
                  idempotencyKey,
                  query: "hospitality",
                  titles: ["Marketing Director"],
                  perPage: 8,
                },
                result: result.result.data.json,
              },
            },
          },
        };
      }
      if (statusIndex >= 0) body[statusIndex] = result;
      await route.fulfill({ response, json: body });
    });
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("hunt-apollo-results-summary")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(restoredCandidate)).toHaveCount(0);
    await expect(page.getByTestId("hunt-apollo-results-toggle")).toHaveText(
      "Review results",
    );
    await page.getByTestId("hunt-apollo-results-toggle").click();
    await expect(page.getByText(restoredCandidate)).toBeVisible();
    await expect(page.getByTestId("hunt-apollo-view-new")).toContainText("1");
    await expect(page.getByTestId("hunt-apollo-title")).toHaveValue(
      "Marketing Director",
    );
    await expect(page.getByTestId("hunt-apollo-query")).toHaveValue(
      "hospitality",
    );
    await expect(page.getByTestId("hunt-apollo-search-status")).toContainText(
      "Restored your latest Apollo search from HRMNY",
    );
    expect(providerSearchCalls).toBe(0);
  });

  test("renders a terminal receipt only for its current principal", async ({
    page,
  }) => {
    const idempotencyKey = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
    const currentCandidate = "CURRENT PARTNER CANDIDATE";
    let approveCalls = 0;
    let enrichCalls = 0;
    await page.addInitScript(
      ({ key, value }) => window.sessionStorage.setItem(key, value),
      {
        key: APOLLO_SEARCH_SESSION_KEY,
        value: JSON.stringify({
          version: 2,
          principalId: PARTNER_EMPLOYEE_ID,
          idempotencyKey,
          titles: ["Marketing Director"],
          perPage: 8,
        }),
      },
    );
    await page.route("**/api/trpc/**", async (route) => {
      const url = route.request().url();
      const procedurePath = decodeURIComponent(
        new URL(url).pathname.split("/api/trpc/")[1] ?? "",
      );
      const procedures = procedurePath.split(",");
      if (url.includes("salesOs.apollo.saveCandidate")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: savedCandidateResponse(),
        });
        return;
      }
      if (url.includes("salesOs.apollo.approveExact")) {
        approveCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  json: {
                    approvalReceiptId: "a3000000-0000-4000-8000-000000000001",
                    candidateHash: "candidate-hash",
                    approvedAt: "2026-09-04T00:00:00.000Z",
                    expiresAt: "2026-09-04T00:05:00.000Z",
                    creditsMaximum: 1,
                  },
                },
              },
            },
          ]),
        });
        return;
      }
      if (url.includes("salesOs.apollo.enrichOne")) {
        enrichCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              result: {
                data: {
                  json: {
                    receiptId: "a4000000-0000-4000-8000-000000000001",
                    duplicate: false,
                    mode: "live",
                    matched: true,
                    creditsRecorded: 1,
                    imported: true,
                    crm: {
                      dealId: "e2000000-0000-4000-8000-000000000001",
                      companyId: "c2000000-0000-4000-8000-000000000001",
                      contactId: "d2000000-0000-4000-8000-000000000001",
                      companyName: "Principal Scoped Result",
                      fullName: currentCandidate,
                      email: "candidate@principal.example",
                      emailVerified: true,
                      reused: { company: true, contact: true, deal: true },
                    },
                  },
                },
              },
            },
          ]),
        });
        return;
      }
      const connectionIndex = procedures.indexOf("salesOs.apollo.connection");
      const searchStatusIndex = procedures.indexOf(
        "salesOs.apollo.searchStatus",
      );
      if (connectionIndex >= 0 || searchStatusIndex >= 0) {
        const response = await route.fetch();
        const body = (await response.json()) as Array<unknown>;
        if (connectionIndex >= 0) {
          body[connectionIndex] = {
            result: {
              data: {
                json: {
                  configured: true,
                  source: "vault",
                  principalId: PARTNER_EMPLOYEE_ID,
                },
              },
            },
          };
        }
        if (searchStatusIndex >= 0) {
          body[searchStatusIndex] = JSON.parse(
            completedSearchResponse(currentCandidate),
          )[0];
        }
        await route.fulfill({ response, json: body });
        return;
      }
      await route.continue();
    });

    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hunt-apollo-results-toggle")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("hunt-apollo-results-toggle").click();
    await expect(page.getByText(currentCandidate)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("hunt-apollo-search-status")).toContainText(
      /current Apollo mock attempt/i,
    );
    await expect(page.getByTestId("hunt-apollo-search-status")).toContainText(
      /receipt c3c3c3c3/i,
    );
    await page
      .getByTestId("hunt-apollo-save-synthetic-completed-person")
      .click();
    const candidate = page.getByTestId(
      "hunt-apollo-candidate-synthetic-completed-person",
    );
    await expect(page.getByTestId("hunt-apollo-view-saved")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(candidate).toHaveClass(/is-saved/);
    await expect(
      page.getByTestId("hunt-apollo-save-synthetic-completed-person"),
    ).toHaveText(/Added to pipeline/i);
    await expect(
      candidate.getByRole("link", { name: /Open this lead in CRM/i }),
    ).toHaveAttribute(
      "href",
      "/crm/deals/e2000000-0000-4000-8000-000000000001",
    );
    const unlock = page.getByTestId(
      "hunt-apollo-enrich-synthetic-completed-person",
    );
    await expect(unlock).toBeEnabled();
    await unlock.click();
    await expect(candidate).toContainText(
      `Confirm ${currentCandidate} at Principal Scoped Result`,
    );
    await page
      .getByTestId("hunt-apollo-enrich-cancel-synthetic-completed-person")
      .click();
    expect(approveCalls).toBe(0);
    await unlock.click();
    await page
      .getByTestId("hunt-apollo-enrich-confirm-synthetic-completed-person")
      .click();
    await expect(candidate).toContainText(
      "candidate@principal.example · verified",
    );
    await expect(unlock).toHaveText(/Work email unlocked/i);
    await expect(unlock).toBeDisabled();
    expect(approveCalls).toBe(1);
    expect(enrichCalls).toBe(1);
    await expect(page.getByTestId("hunt-apollo-search-status")).toContainText(
      `${currentCandidate} is in the pipeline`,
    );
    await expect(
      page.getByRole("link", { name: /Open CRM deal/i }),
    ).toHaveAttribute(
      "href",
      "/crm/deals/e2000000-0000-4000-8000-000000000001",
    );
    await expect
      .poll(() =>
        page.evaluate(
          (key) =>
            JSON.parse(window.sessionStorage.getItem(key) ?? "{}")
              .idempotencyKey,
          APOLLO_SEARCH_SESSION_KEY,
        ),
      )
      .toBe(idempotencyKey);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hunt-apollo-results-toggle")).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId("hunt-apollo-results-toggle").click();
    await expect(page.getByText(currentCandidate)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("does not carry an old employee's pending mutation into the new account", async ({
    page,
  }) => {
    const staleCandidate = "STALE IN-FLIGHT PARTNER RESULT";
    let releaseSearch!: () => void;
    let markSearchStarted!: () => void;
    let markSearchFinished!: () => void;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const searchStarted = new Promise<void>((resolve) => {
      markSearchStarted = resolve;
    });
    const searchFinished = new Promise<void>((resolve) => {
      markSearchFinished = resolve;
    });

    await page.route("**/api/trpc/**", async (route) => {
      const requestUrl = route.request().url();
      const procedurePath = decodeURIComponent(
        new URL(requestUrl).pathname.split("/api/trpc/")[1] ?? "",
      );
      const procedures = procedurePath.split(",");
      if (procedures.includes("salesOs.apollo.search")) {
        markSearchStarted();
        await searchGate;
        try {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: completedSearchResponse(staleCandidate),
          });
        } finally {
          markSearchFinished();
        }
        return;
      }
      const connectionIndex = procedures.indexOf("salesOs.apollo.connection");
      if (connectionIndex >= 0) {
        const response = await route.fetch();
        const body = (await response.json()) as Array<unknown>;
        const isAm = route.request().headers()["x-dev-role"] === "am";
        body[connectionIndex] = {
          result: {
            data: {
              json: {
                configured: !isAm,
                principalId: isAm ? AM_EMPLOYEE_ID : PARTNER_EMPLOYEE_ID,
              },
            },
          },
        };
        await route.fulfill({ response, json: body });
        return;
      }
      await route.continue();
    });

    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    const search = page.getByTestId("hunt-apollo-search");
    await expect(search).toBeEnabled({ timeout: 60_000 });
    await search.click();
    await searchStarted;
    await expect(search).toHaveText("Searching…");

    await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
    await page.locator("#persona").selectOption("am");
    await expect(search).toBeDisabled();
    await expect(search).toHaveText("Connect Apollo to search");
    await expect(search).not.toHaveText("Searching…");
    releaseSearch();
    await searchFinished;
    await page.waitForTimeout(250);
    await expect(page.getByText(staleCandidate)).toHaveCount(0);
    await expect(page.getByTestId("hunt-apollo-results")).toHaveCount(0);
    await expect(page.getByTestId("hunt-apollo-search-status")).toHaveCount(0);
  });

  test("clears a prior employee's pending state when the account changes", async ({
    page,
  }) => {
    const idempotencyKey = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
    const staleCandidate = "STALE PARTNER CANDIDATE MUST NOT RENDER";
    let releaseStatus!: () => void;
    let releaseReadiness!: () => void;
    let markStatusStarted!: () => void;
    let markStatusFinished!: () => void;
    let markReadinessStarted!: () => void;
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const statusStarted = new Promise<void>((resolve) => {
      markStatusStarted = resolve;
    });
    const statusFinished = new Promise<void>((resolve) => {
      markStatusFinished = resolve;
    });
    const readinessGate = new Promise<void>((resolve) => {
      releaseReadiness = resolve;
    });
    const readinessStarted = new Promise<void>((resolve) => {
      markReadinessStarted = resolve;
    });
    let delayedStatus = false;
    let delayedReadiness = false;
    let apolloEffectRequests = 0;
    await page.route("**/api/trpc/**", async (route) => {
      const requestUrl = route.request().url();
      const devRole = route.request().headers()["x-dev-role"];
      const procedurePath = decodeURIComponent(
        new URL(requestUrl).pathname.split("/api/trpc/")[1] ?? "",
      );
      const procedures = new Set(procedurePath.split(","));
      if (
        procedures.has("salesOs.apollo.search") ||
        procedures.has("salesOs.apollo.cancelSearch")
      ) {
        apolloEffectRequests += 1;
      }
      if (!delayedStatus && procedures.has("salesOs.apollo.searchStatus")) {
        delayedStatus = true;
        markStatusStarted();
        await statusGate;
        try {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: completedSearchResponse(staleCandidate),
          });
        } catch {
          // Disabling the old principal's query may cancel the intercepted
          // request, which is also an accepted stale-response outcome.
        } finally {
          markStatusFinished();
        }
        return;
      }
      if (
        devRole === "am" &&
        (procedures.has("auth.session") ||
          procedures.has("salesOs.access") ||
          procedures.has("salesOs.apollo.connection"))
      ) {
        if (!delayedReadiness) {
          delayedReadiness = true;
          markReadinessStarted();
        }
        await readinessGate;
      }
      await route.continue();
    });
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await page.evaluate(
      ({ key, legacyKey, value }) => {
        window.sessionStorage.setItem(key, value);
        window.sessionStorage.setItem(legacyKey, value);
      },
      {
        key: APOLLO_SEARCH_SESSION_KEY,
        legacyKey: LEGACY_APOLLO_SEARCH_SESSION_KEY,
        value: JSON.stringify({
          version: 2,
          principalId: PARTNER_EMPLOYEE_ID,
          idempotencyKey,
          query: "old operator only",
          titles: ["Chief Growth Officer"],
          perPage: 8,
        }),
      },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await statusStarted;
    await expect(page.getByTestId("hunt-apollo-title")).toHaveValue(
      "Chief Growth Officer",
    );
    await expect(page.getByTestId("hunt-apollo-query")).toHaveValue(
      "old operator only",
    );
    await expect(page.getByTestId("hunt-apollo-cancel-search")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          LEGACY_APOLLO_SEARCH_SESSION_KEY,
        ),
      )
      .toBeNull();

    await page.setExtraHTTPHeaders({ "x-dev-role": "am" });
    await page.locator("#persona").selectOption("am");
    await readinessStarted;
    await expect(page.getByTestId("hunt-apollo-search")).toBeDisabled();
    await expect(page.getByTestId("hunt-apollo-search")).toHaveText(
      "Checking employee connection…",
    );
    await page.getByTestId("hunt-apollo-search").evaluate((button) => {
      button.closest("form")?.requestSubmit();
    });
    await page.waitForTimeout(100);
    expect(apolloEffectRequests).toBe(0);
    releaseReadiness();
    await expect(page.getByTestId("hunt-apollo-title")).toHaveValue(
      "Marketing Director",
    );
    await expect(page.getByTestId("hunt-apollo-query")).toHaveValue("");
    expect(apolloEffectRequests).toBe(0);
    await expect(page.getByTestId("hunt-apollo-retry-same-search")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("hunt-apollo-cancel-search")).toHaveCount(0);
    await expect(page.getByTestId("hunt-apollo-search-status")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          APOLLO_SEARCH_SESSION_KEY,
        ),
      )
      .toBeNull();

    releaseStatus();
    await statusFinished;
    await page.waitForTimeout(250);
    await expect(page.getByTestId("hunt-apollo-search-status")).toHaveCount(0);
    await expect(page.getByText(staleCandidate)).toHaveCount(0);
    await expect(page.getByTestId("hunt-apollo-results")).toHaveCount(0);
    await expect(page.getByTestId("hunt-apollo-title")).toHaveValue(
      "Marketing Director",
    );
  });

  test("Sales Growth remains navigable at a narrow client viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    page.setExtraHTTPHeaders({ "x-dev-role": "partner" });
    await page.goto("/crm/hunt", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Find the next right client." }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("navigation", { name: "Sales sections" }),
    ).toBeVisible();
    await expect(page.getByTestId("hunt-apollo-search")).toBeVisible();

    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);

    await page.keyboard.press("Control+k");
    await expect(page).toHaveURL(/\/work\/search$/);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Find the next right client." }),
    ).toBeVisible();

    const crmNav = page.getByRole("navigation", { name: "Sales sections" });
    await expect(crmNav.locator("summary")).toHaveCount(0);
    await expect(crmNav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(crmNav.getByRole("link", { name: "Contacts" })).toBeVisible();
    await expect(
      crmNav.getByRole("link", { name: "Connected tools" }),
    ).toBeVisible();
  });
});
