"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setDevRole, getDevRole, trpc } from "@/lib/trpc";
import { useEffect, useMemo, useState } from "react";
import { initials } from "@/components/crm/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const PRIMARY_NAV = [
  { href: "/", label: "Home", index: "01", match: (p: string) => p === "/" },
  {
    href: "/crm",
    label: "CRM",
    index: "02",
    match: (p: string) => p === "/crm" || p.startsWith("/crm/") || p.startsWith("/sales"),
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
    href: "/hr",
    label: "Ops / HR",
    index: "05",
    match: (p: string) =>
      ["/hr", "/payroll", "/roles"].some((h) => p === h || p.startsWith(`${h}/`)),
  },
  {
    href: "/settings/connections",
    label: "Settings",
    index: "06",
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
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const users = trpc.auth.devUsers.useQuery();
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
        <div className="desk-content">{children}</div>
      </div>
    </div>
  );
}
