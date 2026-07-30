"use client";

import { Button } from "@hrmny/ui";
import { useState } from "react";
import { formatRelative } from "@/components/crm/format";

// mock data — replace with `connections.health` when the connections v2 router
// lands (M7). Real status/lastCheck come from a per-provider health probe; the
// existing api_key/oauth/managed flows below wire the connect/change actions.

type HealthStatus = "connected" | "disconnected" | "error";

type ProviderHealth = {
  key: string;
  name: string;
  category: string;
  authType: "api_key" | "oauth" | "managed";
  status: HealthStatus;
  lastCheck: string | null;
  detail: string;
};

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

const MOCK_PROVIDERS: readonly ProviderHealth[] = [
  {
    key: "composio",
    name: "Composio",
    category: "Agent tool bridge · Gmail send",
    authType: "managed",
    status: "connected",
    lastCheck: minsAgo(4),
    detail: "Workspace healthy · Gmail connected.",
  },
  {
    key: "apollo",
    name: "Apollo",
    category: "ICP sourcing",
    authType: "api_key",
    status: "connected",
    lastCheck: minsAgo(7),
    detail: "Live mode · quota 62% of daily cap.",
  },
  {
    key: "hunter",
    name: "Hunter",
    category: "Email find + verify",
    authType: "api_key",
    status: "error",
    lastCheck: minsAgo(6),
    detail: "401 from provider — re-provision key + NeverBounce credits.",
  },
  {
    key: "xero",
    name: "Xero",
    category: "Finance / accounting",
    authType: "oauth",
    status: "disconnected",
    lastCheck: null,
    detail: "OAuth app registered; not yet authorised.",
  },
  {
    key: "n8n",
    name: "n8n",
    category: "Automation glue",
    authType: "api_key",
    status: "connected",
    lastCheck: minsAgo(12),
    detail: "hrmny.app.n8n.cloud reachable · 3 active workflows.",
  },
];

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

export function ConnectionHealth() {
  // mock optimistic disconnect — real actions dispatch to the connections
  // router; here they only flip local card state.
  const [overrides, setOverrides] = useState<Record<string, HealthStatus>>({});
  const providers = MOCK_PROVIDERS.map((p) => ({
    ...p,
    status: overrides[p.key] ?? p.status,
  }));
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
            Connect, disconnect, or change any integration from here. Each card
            shows its last health check.
          </p>
        </div>
        <p className="text-sm text-muted">
          {connected}/{providers.length} connected
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

              <div className="mt-3 flex flex-wrap gap-2">
                {provider.status === "connected" ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setOverrides((c) => ({
                          ...c,
                          [provider.key]: "disconnected",
                        }))
                      }
                    >
                      Disconnect
                    </Button>
                    <Button type="button" variant="ghost">
                      Change
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    onClick={() =>
                      setOverrides((c) => ({
                        ...c,
                        [provider.key]: "connected",
                      }))
                    }
                  >
                    {provider.status === "error" ? "Reconnect" : "Connect"}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
