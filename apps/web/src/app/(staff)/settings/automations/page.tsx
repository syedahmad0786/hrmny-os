"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function AutomationsSettingsPage() {
  const smoke = trpc.automation.smoke.useQuery(undefined, {
    enabled: false,
    retry: false,
  });
  const eventMap = trpc.automation.eventMap.useQuery();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <p className="text-sm text-muted">
          <Link href="/settings/connections" className="underline">
            Connections
          </Link>{" "}
          · Automations
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          Automations
        </h1>
        <p className="mt-2 text-muted">
          n8n health and workflow list. Triggers stay HITL-gated (
          <code className="text-xs">N8N_ALLOW_PRODUCTION_TRIGGER</code> or
          explicit allow). Configure{" "}
          <code className="text-xs">N8N_API_KEY</code> /{" "}
          <code className="text-xs">N8N_MODE=live</code> in env.
        </p>
      </div>

      <section className="rounded-xl border border-sand bg-white/75 p-4">
        <h2 className="font-display text-xl font-semibold">n8n smoke</h2>
        <button
          type="button"
          className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={smoke.isFetching}
          onClick={() => void smoke.refetch()}
        >
          {smoke.isFetching ? "Running…" : "Run n8n smoke"}
        </button>
        {smoke.error ? (
          <p className="mt-3 text-sm text-red-700">{smoke.error.message}</p>
        ) : null}
        {smoke.data ? (
          <div className="mt-4 space-y-2 text-sm">
            <p>
              Live:{" "}
              <strong className="text-ochre">
                {smoke.data.live ? "yes" : "no (mock or unhealthy)"}
              </strong>
            </p>
            <p>
              Mode {smoke.data.health.mode} · ok={" "}
              {String(smoke.data.health.ok)} · apiKeyConfigured={" "}
              {String(smoke.data.health.apiKeyConfigured)} · workflows{" "}
              {smoke.data.workflowCount}
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-muted">
              {smoke.data.workflows.map((w) => (
                <li key={w.id}>
                  {w.active ? "●" : "○"} {w.name}{" "}
                  <span className="font-mono text-xs">({w.id})</span>
                </li>
              ))}
              {!smoke.data.workflows.length ? (
                <li>No workflows returned</li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-sand bg-white/75 p-4">
        <h2 className="font-display text-xl font-semibold">Event map</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          {(eventMap.data ?? []).map((e) => (
            <li key={e.event}>
              <strong className="text-ink">{e.event}</strong> → {e.workflowName}{" "}
              {e.requiresHitl ? "(HITL)" : ""}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
