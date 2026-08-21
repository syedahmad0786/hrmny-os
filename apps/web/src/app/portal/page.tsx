"use client";

import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { PortalAssetPreview } from "./portal-asset-preview";

export default function PortalHomePage() {
  const session = trpc.portal.auth.session.useQuery(undefined, { retry: false });
  const briefs = trpc.portal.briefs.list.useQuery(undefined, {
    enabled: Boolean(session.data?.clientId),
  });
  const tasks = trpc.portal.tasks.list.useQuery(undefined, {
    enabled: Boolean(session.data?.clientId),
  });
  const assets = trpc.portal.assets.list.useQuery(undefined, {
    enabled: Boolean(session.data?.clientId),
  });
  const deliveries = trpc.portal.deliveries.list.useQuery(undefined, {
    enabled: Boolean(session.data?.clientId),
  });

  return (
    <main className="flex flex-col gap-8">
      <div>
        <p className="font-display text-sm uppercase tracking-[0.2em] text-ochre">
          Client workspace
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
          {session.data?.clientName ?? "Your workspace"}
        </h1>
        <p className="mt-3 max-w-xl text-muted">
          Review briefs, tasks, assets, delivery status, and approvals. Margin,
          payroll, and invoices are never available here.
        </p>
      </div>

      {session.error && (
        <p className="rounded border border-[#D9D0C4] bg-white/60 px-4 py-3 text-sm text-muted">
          Sign in with your portal magic link to open this workspace.{" "}
          <Link href="/portal/login" className="font-medium text-ink underline">
            Go to portal login →
          </Link>
        </p>
      )}

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-display text-lg text-ink">Briefs</h2>
          <ul className="mt-2 space-y-2 text-sm text-muted">
            {(briefs.data ?? []).map((b) => (
              <li key={b.briefId}>
                {b.briefId.slice(0, 8)}… ·{" "}
                {b.lockedAt ? "locked" : "open"} · missing {b.missingRequiredCount}
              </li>
            ))}
            {!briefs.data?.length && <li>No briefs for this client</li>}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-lg text-ink">Tasks</h2>
          <ul className="mt-2 space-y-2 text-sm text-muted">
            {(tasks.data ?? []).map((t) => (
              <li key={t.taskId}>
                {t.title} · <span className="text-ochre">{t.status}</span>
              </li>
            ))}
            {!tasks.data?.length && <li>No tasks for this client</li>}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-lg text-ink">Assets</h2>
          <ul className="mt-2 space-y-4 text-sm text-muted">
            {(assets.data ?? []).map((a) => (
              <li key={a.assetId}>
                <div>
                  {a.title} · {a.status} · v{a.versionCount}
                </div>
                {a.versionCount > 0 ? (
                  <PortalAssetPreview assetId={a.assetId} title={a.title} />
                ) : null}
              </li>
            ))}
            {!assets.data?.length && <li>No assets for this client</li>}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-lg text-ink">Delivery status</h2>
          <ul className="mt-2 space-y-2 text-sm text-muted">
            {(deliveries.data ?? []).map((d) => (
              <li key={d.clientId}>
                Status: <span className="text-ochre">{d.deliveryStatus}</span>
                {d.lastSeam ? ` · last seam ${d.lastSeam}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
