"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setDevRole, getDevRole, trpc } from "@/lib/trpc";
import { useEffect, useMemo, useRef, useState } from "react";
import { initials } from "@/components/crm/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { featureForPathname } from "@/features/catalog";
import { PwaRegister } from "@/components/pwa-register";
import { useTheme, type ThemePreference } from "@/components/theme-provider";

/**
 * Job-oriented primary nav (IA):
 * Today → Pipeline → Clients → Work → Money → People → Admin
 * Delivery lives under Work; Requests/Client preview live in Admin / topbar.
 */
const PRIMARY_NAV = [
  {
    href: "/",
    label: "Today",
    index: "01",
    features: ["core.home"],
    match: (p: string) => p === "/",
    countKey: null as null | "deals",
  },
  {
    href: "/crm",
    label: "Pipeline",
    index: "02",
    features: ["crm.workspace"],
    match: (p: string) =>
      p === "/crm" || p.startsWith("/crm/") || p.startsWith("/sales"),
    countKey: "deals" as const,
  },
  {
    href: "/clients",
    label: "Clients",
    index: "03",
    features: ["crm.workspace"],
    match: (p: string) => p === "/clients" || p.startsWith("/clients/"),
    countKey: null,
  },
  {
    href: "/work",
    label: "Work",
    index: "04",
    features: ["work.projects", "delivery.workspace"],
    match: (p: string) =>
      p === "/work" ||
      p.startsWith("/work/") ||
      ["/delivery", "/traffic", "/creative", "/account", "/assets"].some(
        (h) => p === h || p.startsWith(`${h}/`),
      ),
    countKey: null,
  },
  {
    href: "/finance",
    label: "Money",
    index: "05",
    features: ["finance.workspace"],
    match: (p: string) =>
      ["/finance", "/billing", "/margin"].some(
        (h) => p === h || p.startsWith(`${h}/`),
      ),
    countKey: null,
  },
  {
    href: "/people",
    label: "People",
    index: "06",
    features: [
      "people.core_hr",
      "people.leave_attendance",
      "people.talent",
      "people.payroll",
      "people.shifts_timesheets",
      "people.workplace",
      "people.benefits",
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
        "/payroll",
        "/my-card",
      ].some((h) => p === h || p.startsWith(`${h}/`)),
    countKey: null,
  },
  {
    href: "/admin/features",
    label: "Admin",
    index: "07",
    features: [
      "admin.feature_lab",
      "work.admin_console",
      "integrations.connections",
      "requests.feature_intake",
    ],
    match: (p: string) =>
      p.startsWith("/settings") ||
      p.startsWith("/admin") ||
      p.startsWith("/gate") ||
      p.startsWith("/conventions") ||
      p.startsWith("/dashboards") ||
      p.startsWith("/requests") ||
      p.startsWith("/roles") ||
      p.startsWith("/approvals") ||
      p.startsWith("/client-preview"),
    countKey: null,
  },
] as const;

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const [role, setRole] = useState("partner");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const completingGoogle = useRef(false);
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery(undefined, { retry: false });
  const accessibilityEnabled =
    session.data?.enabledFeatureKeys.includes("work.accessibility") ?? false;
  const accessibility = trpc.work.accessibility.get.useQuery(undefined, {
    enabled: accessibilityEnabled,
    retry: false,
  });
  const users = trpc.auth.devUsers.useQuery();
  const saveGoogleWorkspace = trpc.connections.saveGoogleWorkspace.useMutation({
    onSuccess: async (result) => {
      localStorage.removeItem("hrmny-google-workspace-connect");
      setConnectionMessage(`Google Workspace connected: ${result.account}`);
      await utils.connections.list.invalidate();
      router.replace("/settings/connections");
    },
    onError: (error) => {
      localStorage.removeItem("hrmny-google-workspace-connect");
      setConnectionMessage(error.message);
      router.replace("/settings/connections");
    },
  });
  const deals = trpc.crm.deals.list.useQuery(undefined, {
    enabled: Boolean(session.data?.employeeId),
    staleTime: 30_000,
  });

  const isProductionAuth = session.data?.authMode === "supabase";
  const showDevPersona =
    !isProductionAuth && (users.data ?? []).length > 0;

  useEffect(() => {
    setRole(getDevRole());
  }, []);

  // Sync accessibility theme preference into global theme when server prefs load.
  useEffect(() => {
    if (!accessibilityEnabled || !accessibility.data?.theme) return;
    setPreference(accessibility.data.theme as ThemePreference);
  }, [accessibility.data?.theme, accessibilityEnabled, setPreference]);

  // Colorblind / reduced-motion remain accessibility-feature gated.
  useEffect(() => {
    const root = document.documentElement;
    const preferenceA11y = accessibilityEnabled ? accessibility.data : null;
    if (!preferenceA11y) {
      delete root.dataset.workColorblind;
      delete root.dataset.workReducedMotion;
      return;
    }
    root.dataset.workColorblind = String(preferenceA11y.colorblindMode);
    root.dataset.workReducedMotion = String(preferenceA11y.reducedMotion);
    return () => {
      delete root.dataset.workColorblind;
      delete root.dataset.workReducedMotion;
    };
  }, [accessibility.data, accessibilityEnabled]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "SIGNED_OUT"
      ) {
        void utils.auth.session.invalidate();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [utils]);

  useEffect(() => {
    if (
      session.data?.authMode === "supabase" &&
      !session.data.employeeId &&
      !session.data.email
    ) {
      router.replace("/login");
    }
  }, [router, session.data]);

  useEffect(() => {
    if (session.data?.actorType === "portal") {
      router.replace("/portal");
    }
  }, [router, session.data?.actorType]);

  useEffect(() => {
    if (
      !session.data?.employeeId ||
      completingGoogle.current ||
      localStorage.getItem("hrmny-google-workspace-connect") !== "pending"
    ) {
      return;
    }
    completingGoogle.current = true;
    void getSupabaseBrowserClient()
      ?.auth.getSession()
      .then(({ data, error }) => {
        const providerToken = data.session?.provider_token;
        const refreshToken = data.session?.provider_refresh_token;
        if (error || !providerToken || !refreshToken) {
          throw new Error(
            error?.message ?? "Google did not return an offline refresh token",
          );
        }
        saveGoogleWorkspace.mutate({
          accessToken: providerToken,
          refreshToken,
        });
      })
      .catch((error: unknown) => {
        localStorage.removeItem("hrmny-google-workspace-connect");
        setConnectionMessage(
          error instanceof Error ? error.message : "Google connection failed",
        );
        router.replace("/settings/connections");
      });
  }, [router, saveGoogleWorkspace, session.data?.employeeId]);

  async function onRoleChange(next: string) {
    setDevRole(next);
    setRole(next);
    await utils.invalidate();
    router.refresh();
  }

  async function onSignOut() {
    await getSupabaseBrowserClient()?.auth.signOut();
    await utils.invalidate();
    router.replace("/login");
  }

  const dealCount = useMemo(
    () => String((deals.data ?? []).length || ""),
    [deals.data],
  );

  const avatar = initials(session.data?.displayName ?? "Partner");
  const enabledFeatures = new Set(session.data?.enabledFeatureKeys ?? []);
  const requiredFeature = featureForPathname(pathname);
  const pageEnabled = !requiredFeature || enabledFeatures.has(requiredFeature);

  if (session.isError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>Could not reach the server.</p>
        <button
          type="button"
          className="rounded border border-sand bg-paper px-4 py-2 text-ink"
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
        <p>This account does not have staff access to hrmny OS.</p>
        <button
          type="button"
          className="rounded border border-sand bg-paper px-4 py-2 text-ink"
          onClick={() =>
            void getSupabaseBrowserClient()
              ?.auth.signOut()
              .then(() => router.replace("/login"))
          }
        >
          Sign out and try another account
        </button>
      </main>
    );
  }

  if (
    session.isLoading ||
    session.data?.actorType === "portal" ||
    (session.data?.authMode === "supabase" && !session.data.employeeId)
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted">
        Checking access…
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
        <p className="desk-nav-label">Do the work</p>
        <nav className="desk-nav" aria-label="Primary">
          {PRIMARY_NAV.filter((item) =>
            item.features.some((featureKey) => enabledFeatures.has(featureKey)),
          ).map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`desk-nav-btn${active ? " active" : ""}`}
              >
                <span className="desk-nav-index">{item.index}</span>
                <span>{item.label}</span>
                {item.countKey === "deals" && dealCount ? (
                  <span className="desk-nav-count">{dealCount}</span>
                ) : (
                  <span />
                )}
              </Link>
            );
          })}
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
            <kbd>⌘ K</kbd>
          </Link>
          <div className="desk-top-actions">
            {showDevPersona ? (
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
            <label className="desk-theme-control">
              <span className="sr-only">Theme</span>
              <select
                id="color-theme"
                name="color-theme"
                aria-label="Color theme"
                value={preference}
                onChange={(e) =>
                  setPreference(e.target.value as ThemePreference)
                }
              >
                <option value="system">Theme: System</option>
                <option value="light">Theme: Light</option>
                <option value="dark">Theme: Dark</option>
              </select>
            </label>
            <Link
              href={
                pathname.startsWith("/client-preview")
                  ? "/clients"
                  : "/client-preview"
              }
              className="desk-topbar-primary"
            >
              {pathname.startsWith("/client-preview")
                ? "← Staff view"
                : "Client portal"}
            </Link>
            <Link
              href="/admin/audit"
              className="desk-icon-btn"
              aria-label="Open audit activity"
              title="Audit activity"
            >
              A°
            </Link>
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
        <div className="desk-content" id="staff-main" tabIndex={-1}>
          {connectionMessage ? (
            <p
              className="mb-4 rounded border border-sand bg-paper/70 p-3 text-sm"
              aria-live="polite"
            >
              {connectionMessage}
            </p>
          ) : null}
          {pageEnabled ? (
            children
          ) : (
            <main className="rounded-lg border border-sand bg-paper/70 p-6">
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
