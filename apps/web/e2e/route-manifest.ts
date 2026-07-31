/**
 * Route acceptance manifest — every page route under apps/web/src/app.
 *
 * Framework-free on purpose: imported by both the Playwright crawler
 * (route-acceptance.spec.ts) and the vitest coverage gate
 * (route-manifest.test.ts), neither of which should pull in the other's runtime.
 *
 * ── Access model (verified in src/server/trpc/trpc.ts + the route shells) ──
 * Route-level access is GROUP-based: staff vs portal. There is no per-persona
 * page guard — a finance actor and a partner actor both reach every `(staff)`
 * route; what differs is the data each tRPC call returns (permission is enforced
 * at the data layer, not the route). So `actor` is the enforced boundary and the
 * crawler keys off it; `roles` is the intended-audience annotation only.
 *
 * Enforcement is ASYMMETRIC:
 *  - staff → portal route: PortalShell hard-redirects to /portal/login (client).
 *  - portal → staff route: soft — (staff) layout renders StaffShell for anyone
 *    (auth.session is a public procedure), and the page's own tRPC calls 403 at
 *    the portal/staff boundary. The authoritative deny for this direction is
 *    proven by the boundary probe in the spec, not a per-route redirect.
 */

export type Actor = "staff" | "portal" | "public";
export type RouteExposure = "all" | "development-only";

export interface RouteEntry {
  /** URL path with [param] placeholders preserved (matches the src/app tree). */
  route: string;
  /** Enforced access group. Login pages are "public". */
  actor: Actor;
  /** Concrete URL to visit — dynamic params filled with dev demo-data ids. */
  sample: string;
  /** Intended audience (annotation only; route enforcement is `actor`). */
  roles: Actor[];
  /**
   * "ok"       (default) → document must not be 404 or 500.
   * "notFound"           → an unknown-id target may 404 (must still not 500);
   *                        used for public [param] pages with no seeded record.
   */
  expect?: "notFound";
  /** Hosted preview/production exposure. Omitted means available everywhere. */
  exposure?: RouteExposure;
  /** Final path after a server-side redirect() alias (for humans reading this). */
  redirectsTo?: string;
}

/** Dev demo-data ids — kept in sync with server/auth/session.ts + server/demo-store.ts. */
export const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";
export const DEMO_DEAL_ID = "e0000000-0000-4000-8000-000000000001";

/** Non-batched tRPC probes used to prove the staff/portal boundary denies. */
export const STAFF_TRPC_PROBE = "/api/trpc/admin.roles.list"; // protectedProcedure
export const PORTAL_TRPC_PROBE = "/api/trpc/portal.auth.session"; // portalProcedure

const staff = (route: string, extra: Partial<RouteEntry> = {}): RouteEntry => ({
  route,
  actor: "staff",
  sample: route,
  roles: ["staff"],
  ...extra,
});
const portal = (
  route: string,
  extra: Partial<RouteEntry> = {},
): RouteEntry => ({
  route,
  actor: "portal",
  sample: route,
  roles: ["portal"],
  ...extra,
});
const pub = (route: string, extra: Partial<RouteEntry> = {}): RouteEntry => ({
  route,
  actor: "public",
  sample: route,
  roles: ["public"],
  ...extra,
});

export const ROUTES: RouteEntry[] = [
  // ── (staff) group → URLs have no group prefix ──
  staff("/"),
  staff("/account"),
  staff("/admin/audit"),
  staff("/admin/features"),
  staff("/admin/work"),
  staff("/approvals"),
  staff("/assets", { exposure: "development-only" }),
  staff("/benefits"),
  staff("/billing"),
  staff("/client-preview"),
  staff("/clients"),
  staff("/clients/[id]", { sample: `/clients/${DEMO_CLIENT_ID}` }),
  staff("/conventions"),
  staff("/creative"),
  staff("/crm"),
  staff("/crm/activities"),
  staff("/crm/companies"),
  staff("/crm/contacts"),
  staff("/crm/deals"),
  staff("/crm/deals/[id]", { sample: `/crm/deals/${DEMO_DEAL_ID}` }),
  staff("/crm/inbound"),
  staff("/crm/outreach"),
  staff("/crm/quote"),
  staff("/crm/seams"),
  staff("/crm/tasks"),
  staff("/dashboards"),
  staff("/delivery"),
  staff("/finance"),
  // Dev-only probes: page.tsx 404s (notFound) unless getAuthMode()==="dev".
  // The CI crawler runs in dev auth, so both still render "ok" there.
  staff("/gate", { exposure: "development-only" }),
  staff("/hr", { redirectsTo: "/people" }),
  staff("/margin"),
  staff("/my-card"),
  staff("/payroll"),
  staff("/people"),
  staff("/requests"),
  staff("/roles"),
  // Legacy /sales tree fully removed; server hrefs repoint to /crm.
  staff("/settings/ai"),
  staff("/settings/asana-migration"),
  staff("/settings/connections"),
  staff("/talent"),
  staff("/time"),
  staff("/traffic"),
  staff("/work"),
  staff("/work/ai"),
  staff("/work/ai/studio"),
  staff("/work/ai/teammates"),
  staff("/work/inbox"),
  staff("/work/messages"),
  staff("/work/my-tasks"),
  staff("/work/planning"),
  staff("/work/search"),
  staff("/work/workflows"),
  staff("/work-schedule"),
  staff("/workforce-payroll"),
  staff("/workplace"),

  // ── portal group ──
  portal("/portal"),
  portal("/portal/approvals"),
  portal("/portal/campaign-approvals"),
  portal("/portal/deliveries"),
  portal("/portal/reports"),
  portal("/portal/work"),
  pub("/portal/login"), // login page — renders for anyone (session query is skipped here)
  pub("/portal/login/verify"), // magic-link verify landing — public, token in query; shows error state without one

  // ── public ──
  pub("/login"),
  // Public [param] pages with no seeded demo record → an unknown id 404s cleanly.
  pub("/card/[slug]", { sample: "/card/demo", expect: "notFound" }),
  pub("/forms/[formId]", { sample: "/forms/demo-form" }),
];

/** Static route paths present in the manifest (dynamic ones excluded). */
const STATIC_ROUTES = new Set(
  ROUTES.filter((r) => !r.route.includes("[")).map((r) => r.route),
);

/** Regexes for dynamic manifest routes, e.g. /clients/[id] → ^/clients/[^/]+$ */
const DYNAMIC_MATCHERS = ROUTES.filter((r) => r.route.includes("[")).map((r) =>
  routeToRegex(r.route),
);

export function routeToRegex(route: string): RegExp {
  const pattern = route
    .split("/")
    .map((seg) => {
      if (/^\[\[?\.\.\..+\]\]?$/.test(seg)) return ".*"; // catch-all [...x] / [[...x]]
      if (/^\[.+\]$/.test(seg)) return "[^/]+"; // single [x]
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${pattern}$`);
}

/**
 * True if `path` (a link target, query/hash stripped) resolves to a real route
 * or the API tree. Used by the link-integrity pass.
 */
export function matchesManifest(path: string): boolean {
  let p = path.split(/[?#]/)[0] ?? path;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p === "") p = "/";
  if (p === "/") return true;
  if (p.startsWith("/api/")) return true; // API routes live in the app tree as route.ts
  if (STATIC_ROUTES.has(p)) return true;
  return DYNAMIC_MATCHERS.some((re) => re.test(p));
}
