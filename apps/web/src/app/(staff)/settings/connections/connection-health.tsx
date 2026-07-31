"use client";

import { Button } from "@hrmny/ui";
import { formatRelative } from "@/components/crm/format";
import { trpc } from "@/lib/trpc";

const STATUS: Record<string, { dot: string; pill: string; label: string }> = {
  connected: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-100 text-emerald-800",
    label: "Connected",
  },
  disconnected: {
    dot: "bg-zinc-400",
    pill: "bg-zinc-100 text-zinc-600",
    label: "Disconnected",
  },
  pending: {
    dot: "bg-amber-500",
    pill: "bg-amber-100 text-amber-800",
    label: "Pending",
  },
  error: {
    dot: "bg-red-500",
    pill: "bg-red-100 text-red-800",
    label: "Error",
  },
};

export function ConnectionHealth() {
  const session = trpc.auth.session.useQuery();
  const connections = trpc.connections.list.useQuery(undefined, {
    retry: false,
  });
  const health = trpc.admin.health.get.useQuery(undefined, {
    enabled: Boolean(session.data?.canManageHealth),
    retry: false,
  });

  async function refresh() {
    await Promise.all([
      connections.refetch(),
      session.data?.canManageHealth ? health.refetch() : Promise.resolve(),
    ]);
  }

  const rows = connections.data ?? [];
  const connected = rows.filter((row) => row.status === "connected").length;
  const errored = rows.filter((row) => row.status === "error").length;

  return (
    <section className="rounded-xl border border-sand bg-white/75 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            Connection health
          </p>
          <h2 className="mt-1 font-display text-2xl text-ink">
            Current provider state
          </h2>
          <p className="mt-1 text-sm text-muted">
            Status comes from stored provider checks. Secrets are shown only as
            present or missing.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            {connected}/{rows.length} connected
            {errored ? ` · ${errored} need attention` : ""}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={connections.isFetching || health.isFetching}
          >
            {connections.isFetching || health.isFetching
              ? "Refreshing…"
              : "Refresh"}
          </Button>
        </div>
      </div>

      {connections.isLoading ? (
        <p className="mt-5 text-sm text-muted">Loading connection status…</p>
      ) : null}
      {connections.error ? (
        <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {connections.error.message}
        </p>
      ) : null}
      {!connections.isLoading && !connections.error && rows.length === 0 ? (
        <p className="mt-5 rounded-lg border border-sand p-4 text-sm text-muted">
          No connection providers are configured.
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((provider) => {
          const status = provider.allowed
            ? (STATUS[provider.status] ?? STATUS.disconnected!)
            : {
                dot: "bg-zinc-400",
                pill: "bg-zinc-100 text-zinc-600",
                label: "Blocked",
              };
          return (
            <article
              key={provider.toolkit}
              className="flex flex-col rounded-lg border border-sand bg-white/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base">{provider.label}</h3>
                  <p className="text-xs text-muted">{provider.authType}</p>
                </div>
                <span
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${status.pill}`}
                >
                  <span className={`size-1.5 rounded-full ${status.dot}`} />
                  {status.label}
                </span>
              </div>
              <p className="mt-2 flex-1 text-xs text-muted">
                {provider.lastError ?? provider.note}
              </p>
              <p className="mt-3 text-[11px] text-muted">
                {provider.lastTestedAt
                  ? `Checked ${formatRelative(provider.lastTestedAt)}`
                  : "Never checked"}
                {` · Secret ${provider.hasSecret ? "present" : "not stored"}`}
              </p>
            </article>
          );
        })}
      </div>

      {session.data?.canManageHealth ? (
        <div className="mt-5 border-t border-sand pt-4">
          <p className="text-sm font-medium">Operational signals</p>
          {health.isLoading ? (
            <p className="mt-1 text-sm text-muted">Loading signals…</p>
          ) : health.error ? (
            <p className="mt-1 text-sm text-red-700">{health.error.message}</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                {health.data?.signals.length ?? 0} recent · Google Chat webhook{" "}
                {health.data?.chatWebhookConfigured
                  ? "configured"
                  : "not configured"}
              </p>
              <ul className="mt-3 divide-y divide-sand rounded-lg border border-sand bg-white text-xs">
                {(health.data?.signals ?? []).map((signal) => (
                  <li
                    key={`${signal.signalKey}:${signal.createdAt}`}
                    className="grid gap-1 p-3 sm:grid-cols-[1fr_auto]"
                  >
                    <span>
                      <strong>{signal.signalKey}</strong> · {signal.severity}
                    </span>
                    <span className="text-muted">
                      {signal.deliveryStatus} · {signal.notificationAttempts}{" "}
                      attempt{signal.notificationAttempts === 1 ? "" : "s"}
                    </span>
                    {signal.lastError ? (
                      <span className="text-red-700 sm:col-span-2">
                        {signal.lastError}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
