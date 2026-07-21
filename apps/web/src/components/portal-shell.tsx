"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getDevRole, setDevRole, trpc } from "@/lib/trpc";

const NAV = [
  { href: "/portal", label: "Home" },
  { href: "/portal/deliveries", label: "Deliveries" },
  { href: "/portal/approvals", label: "Approvals" },
  { href: "/portal/reports", label: "Reports" },
];

/** Portal chrome only — never import finance/margin/payroll modules here. */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState("portal_a");
  const utils = trpc.useUtils();
  const session = trpc.portal.auth.session.useQuery(undefined, {
    retry: false,
  });
  const users = trpc.auth.devUsers.useQuery();
  const portalUsers = (users.data ?? []).filter((u) => u.actorType === "portal");

  useEffect(() => {
    const current = getDevRole();
    if (!current.startsWith("portal")) {
      setDevRole("portal_a");
      setRole("portal_a");
    } else {
      setRole(current);
    }
  }, []);

  async function onRoleChange(next: string) {
    setDevRole(next);
    setRole(next);
    await utils.invalidate();
    router.refresh();
  }

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
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 px-4 pb-3">
          {NAV.map((item) => {
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
        </nav>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
    </div>
  );
}
