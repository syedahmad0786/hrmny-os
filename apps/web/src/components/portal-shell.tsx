"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getDevRole, setDevRole, trpc } from "@/lib/trpc";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { featureForPathname } from "@/features/catalog";

const NAV = [
  { href: "/portal", label: "Home", feature: "portal.client" },
  { href: "/portal/work", label: "Shared work", feature: "work.guests" },
  { href: "/portal/onboarding", label: "Onboarding", feature: "portal.client" },
  { href: "/portal/deliveries", label: "Deliveries", feature: "portal.client" },
  { href: "/portal/approvals", label: "Approvals", feature: "portal.client" },
  {
    href: "/portal/campaign-approvals",
    label: "Campaigns",
    feature: "portal.client",
  },
  { href: "/portal/reports", label: "Reports", feature: "portal.client" },
];

/** Portal chrome only — never import finance/margin/payroll modules here. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Login + magic-link verify are pre-auth: no session gate, no redirect.
  const isAuthPage =
    pathname === "/portal/login" || pathname.startsWith("/portal/login/");
  const [role, setRole] = useState("portal_a");
  const utils = trpc.useUtils();
  const session = trpc.portal.auth.session.useQuery(undefined, {
    enabled: !isAuthPage,
    retry: false,
  });
  const users = trpc.auth.devUsers.useQuery();
  const portalUsers = (users.data ?? []).filter(
    (u) => u.actorType === "portal",
  );

  useEffect(() => {
    if (isAuthPage) return;
    const current = getDevRole();
    if (!current.startsWith("portal")) {
      setDevRole("portal_a");
      setRole("portal_a");
    } else {
      setRole(current);
    }
  }, [pathname]);

  useEffect(() => {
    if (!isAuthPage && session.isError) {
      router.replace("/portal/login");
    }
  }, [isAuthPage, router, session.isError]);

  async function onRoleChange(next: string) {
    setDevRole(next);
    setRole(next);
    await utils.invalidate();
    router.refresh();
  }

  async function onSignOut() {
    await getSupabaseBrowserClient()?.auth.signOut();
    await utils.invalidate();
    router.replace("/portal/login");
  }

  if (isAuthPage) return children;

  if (session.isLoading || session.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted">
        Checking portal access…
      </main>
    );
  }

  const enabled = new Set(session.data?.enabledFeatureKeys ?? []);
  const requiredFeature = featureForPathname(pathname);
  const pageEnabled = !requiredFeature || enabled.has(requiredFeature);

  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,#F7F3EE_0%,#EFE8DF_45%,#F7F3EE_100%)]">
      <header className="border-b border-[#D9D0C4]/bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-display text-xs uppercase tracking-[0.25em] text-ochre">
              hrmny portal
            </p>
            <p className="text-sm text-muted">
              {session.data?.displayName ?? "Select portal persona"} ·{" "}
              {session.data?.clientName ?? "—"}
              <span className="ml-2 text-xs text-[#9A9188]">
                (no finance · scoped to client)
              </span>
            </p>
          </div>
          {portalUsers.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">Client persona</span>
              <select
                className="rounded border border-[#D9D0C4] bg-white px-2 py-1"
                value={role}
                onChange={(e) => void onRoleChange(e.target.value)}
              >
                {portalUsers.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 px-4 pb-3">
          {NAV.filter((item) => enabled.has(item.feature)).map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? "rounded px-3 py-1.5 text-sm font-medium text-ochre"
                    : "rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
                }
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/"
            className="ml-auto rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
          >
            Staff app →
          </Link>
          {portalUsers.length === 0 ? (
            <button
              type="button"
              className="rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
              onClick={() => void onSignOut()}
            >
              Sign out
            </button>
          ) : null}
        </nav>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-8">
        {pageEnabled ? (
          children
        ) : (
          <main className="rounded-lg border border-[#D9D0C4] bg-white/70 p-6">
            <h1 className="font-display text-2xl font-semibold">
              This feature is not included in your portal.
            </h1>
            <p className="mt-2 text-sm text-muted">
              Ask your workspace administrator if you need access.
            </p>
          </main>
        )}
      </div>
    </div>
  );
}
