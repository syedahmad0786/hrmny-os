"use client";

import { trpc } from "@/lib/trpc";
import { formatRelative } from "@/components/crm/format";

type HealthStatus = "connected" | "disconnected" | "error";

const STATUS: Record<
  HealthStatus,
  { dot: string; pill: string; label: string }
> = {
  connected: {
    dot: "bg-emerald-500",
    pill: "bg-emerald-100 text-emerald-800",
    label: "Connected",
  },
  disconnected: {
    dot: "bg-sand",
    pill: "bg-zinc-100 text-zinc-600",
    label: "Disconnected",
  },
  error: {
    dot: "bg-red-500",
    pill: "bg-red-100 text-red-800",
    label: "Error",
  },
};

function normalizeStatus(raw: string): HealthStatus {
  if (raw === "connected" || raw === "active") return "connected";
  if (raw === "error") return "error";
  return "disconnected";
}

/** Live catalog from `connections.list` (no mock cards). */
export function ConnectionHealth() {
  const list = trpc.connections.list.useQuery();
  const providers = (list.data ?? []).map((item) => {
    const status = item.lastError
      ? ("error" as const)
      : normalizeStatus(item.status);
    return {
      key: item.toolkit,
      name: item.label,
      category: item.authType,
      status,
      lastCheck: item.lastTestedAt,
      detail: item.lastError
        ? item.lastError
        : status === "connected"
          ? item.hasSecret
            ? "Connected · credential on file"
            : item.note
          : item.note,
    };
  });
  const connected = providers.filter((p) => p.status === "connected").length;
  const errored = providers.filter((p) => p.status === "error").length;

  return (
    <section className="rounded-xl border border-sand bg-white/75 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            Connection health
          </p>
          <h2 className="mt-1 font-display text-2xl text-ink">
            Every external account, one place
          </h2>
          <p className="mt-1 text-sm text-muted">
            Status from your saved connections — connect or change below.
          </p>
        </div>
        <p className="text-sm text-muted">
          {list.isLoading
            ? "Loading…"
            : `${connected}/${providers.length || "—"} connected`}
          {errored ? ` · ${errored} need attention` : ""}
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const status = STATUS[provider.status];
          return (
            <article
              key={provider.key}
              className="flex flex-col rounded-lg border border-sand bg-white/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base">{provider.name}</h3>
                  <p className="text-xs text-muted">{provider.category}</p>
                </div>
                <span
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${status.pill}`}
                >
                  <span className={`size-1.5 rounded-full ${status.dot}`} />
                  {status.label}
                </span>
              </div>
              <p className="mt-2 flex-1 text-xs text-muted">{provider.detail}</p>
              <p className="mt-3 text-[11px] text-muted">
                {provider.lastCheck
                  ? `Checked ${formatRelative(provider.lastCheck)}`
                  : "Never checked"}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
