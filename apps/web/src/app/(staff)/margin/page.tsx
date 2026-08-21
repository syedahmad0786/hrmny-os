"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";

export default function MarginDashboardPage() {
  const session = trpc.auth.session.useQuery();
  const utils = trpc.useUtils();
  const reset = trpc.m5.reset.useMutation({
    onSuccess: () => void utils.dashboards.margin.invalidate(),
  });
  const margin = trpc.dashboards.margin.list.useQuery(undefined, {
    retry: false,
  });

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">
        Per-client margin
      </h1>
      <p className="text-muted">
        Partners and finance only. AM must receive FORBIDDEN — margin fields
        never appear in the payload.
      </p>
      <p className="text-sm text-muted">
        Role: {(session.data?.roles ?? []).join(", ") || "—"} · canViewMargin:{" "}
        {String(session.data?.canViewMargin ?? false)}
      </p>

      {showDemoResets() ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => void reset.mutateAsync()}
        >
          Reset M5 demo (seed retainer + costs)
        </Button>
      ) : null}

      {margin.isError ? (
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <p className="text-sm text-[var(--hrmny-danger)]">
            Denied: {margin.error.message}
          </p>
          <p className="mt-2 text-sm text-muted">
            Switch Dev role to Partner or Finance to view margins.
          </p>
          <Button
            type="button"
            className="mt-3"
            variant="ghost"
            onClick={() => void margin.refetch()}
          >
            Retry
          </Button>
        </section>
      ) : (
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <p className="text-sm text-muted">
            Over-servicing clients: {margin.data?.overServicingCount ?? 0}
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {(margin.data?.rows ?? []).map((row) => (
              <li
                key={row.clientId}
                className="border-t border-sand/60 pt-3 text-sm"
              >
                <p className="font-medium">{row.clientName}</p>
                <p>
                  Fee AED {row.fee} · revenue AED {row.revenueToDate} · cost AED{" "}
                  {row.deliveryCost} · margin {row.marginPct}%
                </p>
                <p className="text-muted">
                  Scope vs actual: {row.scopeVsActualPct}%
                  {row.overServicing ? " · OVER-SERVICING" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
