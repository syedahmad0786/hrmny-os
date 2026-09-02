"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getDevRole, setDevRole, trpc } from "@/lib/trpc";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { featureForPathname } from "@/features/catalog";

const NAV = [
  { href: "/portal", label: "Home" },
  { href: "/portal/approvals", label: "Approvals" },
  { href: "/portal/deliveries", label: "Deliveries" },
  { href: "/portal/reports", label: "Reports" },
] as const;

/** Client-only chrome. Staff, finance, and administration links never render here. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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
    (user) => user.actorType === "portal",
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
  }, [isAuthPage]);

  useEffect(() => {
    if (!isAuthPage && session.isError) router.replace("/portal/login");
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
        Opening your workspace…
      </main>
    );
  }

  const enabled = new Set(session.data?.enabledFeatureKeys ?? []);
  const requiredFeature = featureForPathname(pathname);
  const pageEnabled = !requiredFeature || enabled.has(requiredFeature);

  return (
    <div className="min-h-screen bg-[#f7f4ef]">
      <header className="sticky top-0 z-30 border-b border-[#ddd4c8] bg-[#f7f4ef]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/portal" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[50%_50%_50%_8px] bg-ochre font-display text-lg font-bold text-ink">
              h
            </span>
            <span>
              <strong className="block font-display text-lg leading-none text-ink">
                hrmny
              </strong>
              <small className="mt-1 block text-[10px] text-muted">
                {session.data?.clientName ?? "Client workspace"}
              </small>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {portalUsers.length > 0 ? (
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg border border-[#ddd4c8] bg-white px-3 py-2 text-xs text-muted">
                  Preview client
                </summary>
                <label className="absolute right-0 top-12 z-40 w-56 rounded-xl border border-[#ddd4c8] bg-white p-3 text-xs shadow-lg">
                  <span className="mb-2 block text-muted">Test persona</span>
                  <select
                    className="w-full rounded border border-[#ddd4c8] bg-white px-2 py-2"
                    value={role}
                    onChange={(event) => void onRoleChange(event.target.value)}
                  >
                    {portalUsers.map((user) => (
                      <option key={user.key} value={user.key}>
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
            ) : (
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 text-sm text-muted hover:text-ink"
                onClick={() => void onSignOut()}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
        <nav
          className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6"
          aria-label="Client workspace"
        >
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/portal" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-4 text-sm font-medium ${active ? "bg-ink text-paper" : "text-muted hover:bg-white hover:text-ink"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {pageEnabled ? (
          children
        ) : (
          <main className="rounded-xl border border-[#ddd4c8] bg-white p-6">
            <h1 className="font-display text-2xl font-semibold text-ink">
              This area is not available.
            </h1>
            <p className="mt-2 text-sm text-muted">
              Contact your hrmny account lead if you expected to see it.
            </p>
          </main>
        )}
      </div>
    </div>
  );
}
