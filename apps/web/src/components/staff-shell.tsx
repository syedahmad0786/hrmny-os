"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setDevRole, getDevRole, trpc } from "@/lib/trpc";
import { useEffect, useMemo, useRef, useState } from "react";
import { initials } from "@/components/crm/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const PRIMARY_NAV = [
  { href: "/", label: "Home", index: "01", match: (p: string) => p === "/" },
  {
    href: "/crm",
    label: "CRM",
    index: "02",
    match: (p: string) =>
      p === "/crm" || p.startsWith("/crm/") || p.startsWith("/sales"),
  },
  {
    href: "/delivery",
    label: "Delivery",
    index: "03",
    match: (p: string) =>
      ["/delivery", "/traffic", "/creative", "/account", "/assets"].some(
        (h) => p === h || p.startsWith(`${h}/`),
      ),
  },
  {
    href: "/finance",
    label: "Finance",
    index: "04",
    match: (p: string) =>
      ["/finance", "/billing", "/margin"].some(
        (h) => p === h || p.startsWith(`${h}/`),
      ),
  },
  {
    href: "/people",
    label: "People / HR",
    index: "05",
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
        "/roles",
      ].some((h) => p === h || p.startsWith(`${h}/`)),
  },
  {
    href: "/requests",
    label: "Requests",
    index: "06",
    match: (p: string) => p === "/requests" || p.startsWith("/requests/"),
  },
  {
    href: "/client-preview",
    label: "Client Preview",
    index: "07",
    match: (p: string) => p.startsWith("/client-preview"),
  },
  {
    href: "/settings/connections",
    label: "Admin",
    index: "08",
    match: (p: string) =>
      p.startsWith("/settings") ||
      p.startsWith("/admin") ||
      p.startsWith("/gate") ||
      p.startsWith("/conventions") ||
      p.startsWith("/dashboards"),
  },
] as const;

export function StaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState("partner");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const completingGoogle = useRef(false);
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
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

  useEffect(() => {
    setRole(getDevRole());
  }, []);

  useEffect(() => {
    if (
      session.isError ||
      (session.data?.authMode === "supabase" && !session.data.employeeId)
    ) {
      router.replace("/login");
    }
  }, [router, session.data, session.isError]);

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

  if (
    session.isLoading ||
    session.isError ||
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
          {PRIMARY_NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`desk-nav-btn${active ? " active" : ""}`}
              >
                <span className="desk-nav-index">{item.index}</span>
                <span>{item.label}</span>
                {item.label === "CRM" && dealCount ? (
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
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Staff desk
            </p>
            <p className="font-display text-sm font-semibold text-ink">
              {session.data?.displayName ?? "…"}
            </p>
          </div>
          {(users.data ?? []).length > 0 ? (
            <div className="desk-devbox">
              <label htmlFor="persona">Persona</label>
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
          {session.data?.authMode === "supabase" && session.data.employeeId ? (
            <button
              type="button"
              className="text-xs underline"
              onClick={() => void onSignOut()}
            >
              Sign out
            </button>
          ) : null}
          <span className="desk-avatar" aria-hidden>
            {avatar}
          </span>
        </header>
        <div className="desk-content">
          {connectionMessage ? (
            <p className="mb-4 rounded border border-sand bg-white/70 p-3 text-sm">
              {connectionMessage}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
