"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { setDevRole, getDevRole, trpc } from "@/lib/trpc";
import { useEffect, useMemo, useRef, useState } from "react";
import { initials } from "@/components/crm/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { featureForPathname } from "@/features/catalog";
import { PwaRegister } from "@/components/pwa-register";
import { isSyntheticRecordName } from "@/lib/synthetic-records";
import { rankStaffNavigation, type StaffNavId } from "@/lib/staff-workspace";

type StaffCapability = "canAdminFeatures" | "canAdminWork" | "canViewAudit";

type StaffNavDefinition = {
  id: StaffNavId;
  label: string;
  index: string;
  destinations: readonly {
    href: string;
    feature: string;
    capability?: StaffCapability;
  }[];
  match: (pathname: string) => boolean;
};

const PRIMARY_NAV: readonly StaffNavDefinition[] = [
  {
    id: "home",
    label: "Today",
    index: "01",
    destinations: [{ href: "/", feature: "core.home" }],
    match: (p: string) => p === "/",
  },
  {
    id: "sales",
    label: "Sales",
    index: "02",
    destinations: [{ href: "/crm/dashboard", feature: "crm.workspace" }],
    match: (p: string) =>
      p === "/crm" || p.startsWith("/crm/") || p.startsWith("/sales"),
  },
  {
    id: "clients",
    label: "Clients",
    index: "03",
    destinations: [{ href: "/clients", feature: "crm.workspace" }],
    match: (p: string) => p === "/clients" || p.startsWith("/clients/"),
  },
  {
    id: "work",
    label: "My work",
    index: "04",
    destinations: [
      { href: "/work/my-tasks", feature: "work.my_tasks" },
      { href: "/work", feature: "work.projects" },
    ],
    match: (p: string) =>
      p === "/work" ||
      (p.startsWith("/work/") && !p.startsWith("/work/inbox")) ||
      p === "/tasks" ||
      p.startsWith("/tasks/"),
  },
  {
    id: "delivery",
    label: "Delivery",
    index: "05",
    destinations: [{ href: "/delivery", feature: "delivery.workspace" }],
    match: (p: string) =>
      ["/delivery", "/traffic", "/creative", "/account", "/assets"].some(
        (h) => p === h || p.startsWith(`${h}/`),
      ),
  },
  {
    id: "chat",
    label: "Chat",
    index: "06",
    destinations: [{ href: "/chat", feature: "ai.os_chat" }],
    match: (p: string) => p === "/chat" || p.startsWith("/chat/"),
  },
  {
    id: "support",
    label: "Support",
    index: "07",
    destinations: [
      { href: "/tickets", feature: "support.tickets" },
      { href: "/notifications", feature: "os.notifications" },
      { href: "/work/inbox", feature: "work.inbox" },
    ],
    match: (p: string) =>
      p === "/tickets" ||
      p.startsWith("/tickets/") ||
      p === "/notifications" ||
      p.startsWith("/notifications/") ||
      p === "/approvals" ||
      p.startsWith("/approvals/") ||
      p === "/work/inbox" ||
      p.startsWith("/work/inbox/"),
  },
  {
    id: "finance",
    label: "Finance",
    index: "08",
    destinations: [{ href: "/finance", feature: "finance.workspace" }],
    match: (p: string) =>
      ["/finance", "/billing", "/margin", "/payroll"].some(
        (h) => p === h || p.startsWith(`${h}/`),
      ),
  },
  {
    id: "insights",
    label: "Reports",
    index: "09",
    destinations: [{ href: "/dashboards", feature: "analytics.dashboards" }],
    match: (p: string) => p === "/dashboards" || p.startsWith("/dashboards/"),
  },
  {
    id: "people",
    label: "People",
    index: "10",
    destinations: [
      { href: "/people", feature: "people.core_hr" },
      { href: "/time", feature: "people.leave_attendance" },
      { href: "/talent", feature: "people.talent" },
      { href: "/workforce-payroll", feature: "people.payroll" },
      { href: "/work-schedule", feature: "people.shifts_timesheets" },
      { href: "/workplace", feature: "people.workplace" },
      { href: "/benefits", feature: "people.benefits" },
    ],
    match: (p: string) =>
      [
        "/people",
        "/time",
        "/talent",
        "/benefits",
        "/work-schedule",
        "/workplace",
        "/workforce-payroll",
        "/hr",
      ].some((h) => p === h || p.startsWith(`${h}/`)),
  },
  {
    id: "settings",
    label: "Settings",
    index: "11",
    destinations: [
      {
        href: "/admin/features",
        feature: "admin.feature_lab",
        capability: "canAdminFeatures",
      },
      {
        href: "/admin/work",
        feature: "work.admin_console",
        capability: "canAdminWork",
      },
      { href: "/settings/connections", feature: "integrations.connections" },
    ],
    match: (p: string) =>
      p.startsWith("/settings") ||
      p.startsWith("/admin") ||
      p.startsWith("/gate") ||
      p.startsWith("/conventions") ||
      p.startsWith("/roles"),
  },
];

type ResolvedNavItem = {
  id: StaffNavId;
  href: string;
  label: string;
  index: string;
  match: (pathname: string) => boolean;
};

export function StaffShell({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState("partner");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [accessCheckExpired, setAccessCheckExpired] = useState(false);
  const completingGoogle = useRef(false);
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const enabledFeatures = useMemo(
    () => new Set(session.data?.enabledFeatureKeys ?? []),
    [session.data?.enabledFeatureKeys],
  );
  const accessibilityEnabled = enabledFeatures.has("work.accessibility");
  const accessibility = trpc.work.accessibility.get.useQuery(undefined, {
    enabled: accessibilityEnabled,
    retry: false,
  });
  const users = trpc.auth.devUsers.useQuery();
  const saveGoogleWorkspace = trpc.connections.saveGoogleWorkspace.useMutation({
    onSuccess: async (result) => {
      localStorage.removeItem("hrmny-google-workspace-connect");
      sessionStorage.removeItem("hrmny-gw-oauth-tokens");
      setConnectionMessage(`Google Workspace connected: ${result.account}`);
      await utils.connections.list.invalidate();
      router.replace("/settings/connections");
    },
    onError: (error) => {
      localStorage.removeItem("hrmny-google-workspace-connect");
      sessionStorage.removeItem("hrmny-gw-oauth-tokens");
      setConnectionMessage(error.message);
      router.replace("/settings/connections");
    },
  });
  const deals = trpc.crm.deals.list.useQuery(undefined, {
    enabled:
      Boolean(session.data?.employeeId) && enabledFeatures.has("crm.workspace"),
    staleTime: 30_000,
  });
  const waitingForAccess =
    session.isLoading ||
    session.data?.actorType === "portal" ||
    (session.data?.authMode === "supabase" && !session.data.employeeId);

  useEffect(() => {
    setRole(getDevRole());
  }, []);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      router.push("/work/search");
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [router]);

  useEffect(() => {
    const root = document.documentElement;
    const preference = accessibilityEnabled ? accessibility.data : null;
    if (!preference) {
      delete root.dataset.workTheme;
      delete root.dataset.workColorblind;
      delete root.dataset.workReducedMotion;
      return;
    }
    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.workTheme =
        preference.theme === "system"
          ? darkMode.matches
            ? "dark"
            : "light"
          : preference.theme;
    };
    applyTheme();
    root.dataset.workColorblind = String(preference.colorblindMode);
    root.dataset.workReducedMotion = String(preference.reducedMotion);
    if (preference.theme === "system")
      darkMode.addEventListener("change", applyTheme);
    return () => {
      darkMode.removeEventListener("change", applyTheme);
      delete root.dataset.workTheme;
      delete root.dataset.workColorblind;
      delete root.dataset.workReducedMotion;
    };
  }, [accessibility.data, accessibilityEnabled]);

  // Refetch the session whenever Supabase auth settles — the OAuth landing
  // exchanges tokens asynchronously, so the first session query can race it
  // and cache "anonymous" (the root cause of the stuck "Checking access…").
  // Also stash Google Workspace provider tokens immediately — they often vanish
  // from getSession() by the time employeeId resolves after OAuth redirect.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "SIGNED_OUT"
      ) {
        void utils.auth.session.invalidate();
      }
      if (
        (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
        localStorage.getItem("hrmny-google-workspace-connect") === "pending" &&
        session?.provider_token &&
        session?.provider_refresh_token
      ) {
        try {
          sessionStorage.setItem(
            "hrmny-gw-oauth-tokens",
            JSON.stringify({
              accessToken: session.provider_token,
              refreshToken: session.provider_refresh_token,
            }),
          );
        } catch {
          /* sessionStorage may be unavailable */
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [utils]);

  // Truly anonymous (no Supabase identity at all) → go sign in. A signed-in
  // user with no employee row gets the explicit denied screen below instead —
  // bouncing them to /login would loop them through Google forever.
  useEffect(() => {
    if (
      session.data?.authMode === "supabase" &&
      !session.data.employeeId &&
      !session.data.email
    ) {
      router.replace("/login");
    }
  }, [router, session.data]);

  // A portal actor must never render staff chrome. The tRPC layer already denies
  // portal callers on staff procedures (portalStaffBoundary); this closes the soft
  // UI boundary where the (staff) shell rendered before that data-layer denial.
  useEffect(() => {
    if (session.data?.actorType === "portal") {
      router.replace("/portal");
    }
  }, [router, session.data?.actorType]);

  useEffect(() => {
    if (!waitingForAccess) {
      setAccessCheckExpired(false);
      return;
    }

    const timer = window.setTimeout(() => setAccessCheckExpired(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [waitingForAccess]);

  useEffect(() => {
    if (
      !session.data?.employeeId ||
      completingGoogle.current ||
      localStorage.getItem("hrmny-google-workspace-connect") !== "pending"
    ) {
      return;
    }
    completingGoogle.current = true;

    function readStashedTokens(): {
      accessToken: string;
      refreshToken: string;
    } | null {
      try {
        const raw = sessionStorage.getItem("hrmny-gw-oauth-tokens");
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          accessToken?: unknown;
          refreshToken?: unknown;
        };
        if (
          typeof parsed.accessToken === "string" &&
          parsed.accessToken &&
          typeof parsed.refreshToken === "string" &&
          parsed.refreshToken
        ) {
          return {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
          };
        }
      } catch {
        /* ignore */
      }
      return null;
    }

    const stashed = readStashedTokens();
    if (stashed) {
      saveGoogleWorkspace.mutate({
        accessToken: stashed.accessToken,
        refreshToken: stashed.refreshToken,
      });
      return;
    }

    void getSupabaseBrowserClient()
      ?.auth.getSession()
      .then(({ data, error }) => {
        const providerToken = data.session?.provider_token;
        const refreshToken = data.session?.provider_refresh_token;
        if (error || !providerToken || !refreshToken) {
          throw new Error(
            error?.message ??
              "Google tokens expired before save — use Reconnect on Connections (dedicated Google OAuth, not Heal).",
          );
        }
        saveGoogleWorkspace.mutate({
          accessToken: providerToken,
          refreshToken,
        });
      })
      .catch((error: unknown) => {
        completingGoogle.current = false;
        localStorage.removeItem("hrmny-google-workspace-connect");
        sessionStorage.removeItem("hrmny-gw-oauth-tokens");
        setConnectionMessage(
          error instanceof Error ? error.message : "Google connection failed",
        );
        router.replace("/settings/connections");
      });
  }, [router, saveGoogleWorkspace, session.data?.employeeId]);

  async function onRoleChange(next: string) {
    setDevRole(next);
    setRole(next);
    await queryClient.cancelQueries();
    await queryClient.resetQueries();
    router.refresh();
  }

  async function onSignOut() {
    await getSupabaseBrowserClient()?.auth.signOut();
    await queryClient.cancelQueries();
    await queryClient.resetQueries();
    router.replace("/login");
  }

  async function onRecoverSession() {
    await getSupabaseBrowserClient()?.auth.signOut({ scope: "local" });
    await queryClient.cancelQueries();
    await queryClient.resetQueries();
    router.replace("/login");
  }

  const dealCount = useMemo(
    () =>
      String(
        (deals.data ?? []).filter(
          (deal) =>
            !deal.closeOutcome && !isSyntheticRecordName(deal.companyName),
        ).length || "",
      ),
    [deals.data],
  );

  const avatar = initials(session.data?.displayName ?? "Partner");
  const requiredFeature = featureForPathname(pathname);
  const pageEnabled = !requiredFeature || enabledFeatures.has(requiredFeature);
  const availableNavigation: ResolvedNavItem[] = PRIMARY_NAV.flatMap((item) => {
    if (
      item.id === "finance" &&
      !session.data?.roles.some((role) =>
        ["partner", "director", "finance"].includes(role),
      )
    ) {
      return [];
    }
    const destination = item.destinations.find(
      ({ feature, capability }) =>
        enabledFeatures.has(feature) &&
        (!capability || Boolean(session.data?.[capability])),
    );
    return destination
      ? [
          {
            id: item.id,
            href: destination.href,
            label: item.label,
            index: item.index,
            match: item.match,
          },
        ]
      : [];
  });
  const navigation = rankStaffNavigation(
    session.data?.roles ?? [],
    availableNavigation,
  );
  const moreActive = navigation.more.some((item) => item.match(pathname));
  const renderNavItem = (item: ResolvedNavItem) => {
    const active = item.match(pathname);
    return (
      <Link
        key={item.id}
        href={item.href}
        aria-label={item.label}
        className={`desk-nav-btn${active ? " active" : ""}`}
      >
        <span className="desk-nav-index">{item.index}</span>
        <span>{item.label}</span>
        {item.id === "sales" && dealCount ? (
          <span className="desk-nav-count">{dealCount}</span>
        ) : (
          <span />
        )}
      </Link>
    );
  };

  if (session.isError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>Could not reach the server.</p>
        <button
          type="button"
          className="rounded border border-sand bg-white px-4 py-2 text-ink"
          onClick={() => void session.refetch()}
        >
          Retry
        </button>
      </main>
    );
  }

  if (
    session.data?.authMode === "supabase" &&
    !session.data.employeeId &&
    session.data.email
  ) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted">
        <p className="text-ink">
          Signed in as <strong>{session.data.email}</strong>
        </p>
        <p>
          This account does not have staff access to hrmny OS. Staff seats are
          provisioned for approved @hrmny.co employees — ask a partner to add
          your employee row, then sign in again.
        </p>
        <button
          type="button"
          className="rounded border border-sand bg-white px-4 py-2 text-ink"
          onClick={() =>
            void getSupabaseBrowserClient()
              ?.auth.signOut()
              .then(() => router.replace("/login"))
          }
        >
          Sign out and try another @hrmny.co account
        </button>
      </main>
    );
  }

  if (waitingForAccess) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted">
        {accessCheckExpired ? (
          <>
            <p className="text-ink">
              The access check is taking longer than expected.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-sand bg-white px-4 py-2 text-ink"
                onClick={() => void session.refetch()}
              >
                Retry
              </button>
              <button
                type="button"
                className="rounded border border-sand bg-white px-4 py-2 text-ink"
                onClick={() => void onRecoverSession()}
              >
                Sign in again
              </button>
            </div>
          </>
        ) : (
          <p>Checking access…</p>
        )}
      </main>
    );
  }

  return (
    <div className="desk-shell">
      <PwaRegister enabled={enabledFeatures.has("work.mobile_pwa")} />
      <a className="work-skip-link" href="#staff-main">
        Skip to main content
      </a>
      <aside className="desk-sidebar">
        <Link href="/" className="desk-brand">
          <span className="desk-brand-mark">
            <span>h</span>
          </span>
          hrmny <small>OS</small>
        </Link>
        <div className="desk-side-context">
          <span>Workspace</span>
          <strong>Creative Harmony</strong>
        </div>
        <p className="desk-nav-label">Operate</p>
        <nav className="desk-nav" aria-label="Primary">
          {navigation.primary.map(renderNavItem)}
          {navigation.more.length ? (
            <details className="desk-nav-more" open={moreActive || undefined}>
              <summary
                className={`desk-nav-btn desk-nav-more-toggle${moreActive ? " active" : ""}`}
                data-testid="staff-more-toggle"
              >
                <span className="desk-nav-index">+</span>
                <span>More</span>
                <span aria-hidden>⌄</span>
              </summary>
              <div className="desk-nav-more-list">
                {navigation.more.map(renderNavItem)}
              </div>
            </details>
          ) : null}
        </nav>
        <div className="desk-sidebar-foot">
          <div className="desk-side-meta">
            {(session.data?.roles ?? []).join(" · ") || "staff"}
            <br />
            {session.data?.canViewMargin ? "Margin visible" : "Margin redacted"}
          </div>
        </div>
      </aside>

      <div className="desk-workspace">
        <header className="desk-topbar">
          <Link href="/work/search" className="desk-search-trigger">
            <span className="desk-search-icon" aria-hidden>
              ⌕
            </span>
            <span className="desk-search-copy">
              Search clients, deals, tasks…
            </span>
            <kbd>Ctrl K</kbd>
          </Link>
          <div className="desk-top-actions">
            {enabledFeatures.has("integrations.connections") ? (
              <Link href="/settings/connections" className="desk-topbar-link">
                Connections
              </Link>
            ) : null}
            {enabledFeatures.has("os.notifications") ? (
              <Link
                href="/notifications"
                className="desk-icon-btn"
                aria-label="Open notifications"
                title="Notifications"
              >
                <span aria-hidden>●</span>
              </Link>
            ) : null}
            {(users.data ?? []).length > 0 ? (
              <div className="desk-devbox">
                <label htmlFor="persona">Dev only</label>
                <select
                  id="persona"
                  value={role}
                  onChange={(e) => void onRoleChange(e.target.value)}
                >
                  {users.data!.map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {session.data?.canPreviewClient &&
            enabledFeatures.has("portal.client") ? (
              <Link
                href={
                  pathname.startsWith("/client-preview")
                    ? "/clients"
                    : "/client-preview"
                }
                className="desk-topbar-primary"
              >
                {pathname.startsWith("/client-preview")
                  ? "← Staff admin"
                  : "Client view"}
              </Link>
            ) : null}
            {session.data?.canViewAudit &&
            enabledFeatures.has("admin.audit") ? (
              <Link
                href="/admin/audit"
                className="desk-icon-btn"
                aria-label="Open audit activity"
                title="Audit activity"
              >
                A°
              </Link>
            ) : null}
            {session.data?.authMode === "supabase" &&
            session.data.employeeId ? (
              <button
                type="button"
                className="desk-avatar"
                onClick={() => void onSignOut()}
                aria-label={`Sign out ${session.data.displayName ?? "account"}`}
                title="Sign out"
              >
                {avatar}
              </button>
            ) : (
              <span
                className="desk-avatar"
                title={session.data?.displayName ?? "Partner"}
                aria-hidden
              >
                {avatar}
              </span>
            )}
          </div>
        </header>
        <div
          key={session.data?.employeeId ?? "anonymous"}
          className="desk-content"
          id="staff-main"
          tabIndex={-1}
        >
          {connectionMessage ? (
            <p
              className="mb-4 rounded border border-sand bg-white/70 p-3 text-sm"
              aria-live="polite"
            >
              {connectionMessage}
            </p>
          ) : null}
          {pageEnabled ? (
            children
          ) : (
            <main className="rounded-lg border border-sand bg-white/70 p-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
                Feature unavailable
              </p>
              <h1 className="mt-2 font-display text-2xl font-semibold">
                This area is switched off for your access scope.
              </h1>
              <p className="mt-2 text-sm text-muted">
                Ask a Feature Lab administrator if you need access.
              </p>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
