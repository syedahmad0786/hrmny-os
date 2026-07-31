import { test, expect, type Page } from "@playwright/test";
import {
  ROUTES,
  type Actor,
  type RouteEntry,
  matchesManifest,
  PORTAL_TRPC_PROBE,
  STAFF_TRPC_PROBE,
} from "./route-manifest";

/**
 * Route-and-action acceptance crawl (PLAN-PRODUCTION.md §"Test Plan").
 *
 * For partner + finance (staff) and portal_a (portal), via the x-dev-role header:
 *  - every intended route renders (doc not 404/500, no Next error boundary),
 *  - forbidden routes deny (see the access model in route-manifest.ts),
 *  - every internal <a href> on a rendered page resolves to a real route.
 *
 * NOTE: browser execution happens in CI. This machine cannot run it (loopback
 * swallows chunked responses); the runnable local gate is route-manifest.test.ts.
 */

const ROLES: { key: string; group: Actor }[] = [
  { key: "partner", group: "staff" },
  { key: "finance", group: "staff" },
  { key: "portal_a", group: "portal" },
];

const ERROR_BOUNDARY = /Application error|Unhandled Runtime Error/i;

/** Links collected across the crawl, validated once at the end. */
const discoveredLinks = new Map<string, string>(); // target → first page it was seen on

function isAllowed(group: Actor, route: RouteEntry): boolean {
  return route.actor === "public" || route.actor === group;
}

async function assertRenders(page: Page, route: RouteEntry, label: string) {
  const resp = await page.goto(route.sample, { waitUntil: "domcontentloaded" });
  const status = resp?.status() ?? 0;
  if (route.expect === "notFound") {
    expect
      .soft(status, `${label} ${route.sample} must not 500`)
      .toBeLessThan(500);
  } else {
    expect.soft(status, `${label} ${route.sample} must not 404`).not.toBe(404);
    expect
      .soft(status, `${label} ${route.sample} must not 5xx`)
      .toBeLessThan(500);
  }
  await expect
    .soft(
      page.getByText(ERROR_BOUNDARY),
      `${label} ${route.sample} error boundary`,
    )
    .toHaveCount(0);

  if (route.exposure === "development-only") return;

  // Group landmark confirms the actor actually reached the intended surface.
  if (route.actor === "staff") {
    await expect
      .soft(
        page.getByRole("navigation", { name: "Primary" }),
        `${label} ${route.sample} staff shell`,
      )
      .toBeVisible({ timeout: 15_000 });
  } else if (route.actor === "portal") {
    expect
      .soft(
        page.url(),
        `${label} ${route.sample} should not bounce to portal login`,
      )
      .not.toContain("/portal/login");
  }
}

async function collectLinks(page: Page, seenOn: string) {
  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
  for (const href of hrefs) {
    if (!href.startsWith("/") || href.startsWith("//")) continue; // internal, path-absolute only
    if (!discoveredLinks.has(href)) discoveredLinks.set(href, seenOn);
  }
}

for (const role of ROLES) {
  test.describe(`routes · ${role.key}`, () => {
    test.use({ extraHTTPHeaders: { "x-dev-role": role.key } });

    test(`crawl (${role.group} actor)`, async ({ page }) => {
      test.setTimeout(480_000);
      for (const route of ROUTES) {
        if (isAllowed(role.group, route)) {
          await assertRenders(page, route, role.key);
          await collectLinks(page, route.sample);
          continue;
        }

        // Forbidden. Enforcement is asymmetric (see route-manifest.ts).
        if (route.actor === "portal") {
          // staff → portal: PortalShell hard-redirects to /portal/login.
          await page.goto(route.sample, { waitUntil: "domcontentloaded" });
          await page
            .waitForURL(/\/portal\/login/, { timeout: 8_000 })
            .catch(() => {});
          expect
            .soft(page.url(), `${role.key} must be denied ${route.sample}`)
            .toContain("/portal/login");
        } else {
          // portal → staff: soft. StaffShell renders for anyone; the deny is at the
          // data layer (proven by the boundary probe below). Here we only require
          // the page degrades gracefully instead of crashing.
          // ponytail: no per-route data-leak assertion — tRPC batching makes the
          // network status ambiguous; the boundary probe is the authoritative gate.
          const resp = await page.goto(route.sample, {
            waitUntil: "domcontentloaded",
          });
          expect
            .soft(
              resp?.status() ?? 0,
              `${role.key} on ${route.sample} must not 5xx`,
            )
            .toBeLessThan(500);
          await expect
            .soft(
              page.getByText(ERROR_BOUNDARY),
              `${role.key} on ${route.sample} error boundary`,
            )
            .toHaveCount(0);
        }
      }
    });
  });
}

test.describe("access boundary (deterministic)", () => {
  test("portal actor is denied a staff tRPC endpoint", async ({ request }) => {
    const res = await request.get(STAFF_TRPC_PROBE, {
      headers: { "x-dev-role": "portal_a" },
    });
    expect(res.status(), "portal_a → staff API must be 403").toBe(403);
  });

  test("staff actor is denied a portal tRPC endpoint", async ({ request }) => {
    const res = await request.get(PORTAL_TRPC_PROBE, {
      headers: { "x-dev-role": "partner" },
    });
    expect(res.status(), "partner → portal API must be 403").toBe(403);
  });
});

test.describe("link integrity", () => {
  // Runs last so the per-role crawls above have populated discoveredLinks.
  test("every internal link points at a real route", () => {
    const broken = [...discoveredLinks.entries()]
      .filter(([target]) => !matchesManifest(target))
      .map(([target, seenOn]) => `${target}  (linked from ${seenOn})`);
    expect(broken, `dead internal links:\n${broken.join("\n")}`).toEqual([]);
  });
});
