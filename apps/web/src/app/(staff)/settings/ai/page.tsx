"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatAed, formatRelative } from "@/components/crm/format";
import {
  MONTHLY_CAP_AED,
  useAiAdmin,
  type GateOutcome,
} from "./mock-data";

const GATE_TONE: Record<GateOutcome, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  auto: "bg-sky-100 text-sky-800",
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-800",
};

export default function AiAdminPage() {
  const { agents, runs } = useAiAdmin();
  // mock local toggle — real kill switch is a mutation on the `aiAdmin` router
  // (env or DB-backed per-agent `enabled`).
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(agents.map((a) => [a.key, a.enabled])),
  );

  const spendAed = useMemo(
    () => agents.reduce((sum, a) => sum + a.spendAed, 0),
    [agents],
  );
  const pct = Math.min(100, (spendAed / MONTHLY_CAP_AED) * 100);
  const capTone =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-ochre";
  const activeCount = Object.values(enabled).filter(Boolean).length;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Admin · AI
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            AI control panel
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Per-agent kill switches, monthly spend against the AED&nbsp;1,500
            cap, and the most recent runs with their gate outcome. The cap is a
            hard circuit breaker — it fails closed.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Admin settings">
          <Link
            className="rounded-full bg-ink px-4 py-2 text-white"
            href="/settings/ai"
          >
            AI
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/approvals"
          >
            Approvals
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/settings/connections"
          >
            Connections
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/admin/features"
          >
            Feature Lab
          </Link>
        </nav>
      </header>

      <section className="rounded-xl border border-sand bg-white/75 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
              Monthly spend
            </p>
            <p className="mt-1 font-display text-3xl font-semibold">
              {formatAed(spendAed)}{" "}
              <span className="text-base font-normal text-muted">
                of {formatAed(MONTHLY_CAP_AED)}
              </span>
            </p>
          </div>
          <p className="text-sm text-muted">
            {formatAed(MONTHLY_CAP_AED - spendAed)} remaining ·{" "}
            {activeCount}/{agents.length} agents on
          </p>
        </div>
        <div
          className="mt-3 h-3 w-full overflow-hidden rounded-full bg-sand/60"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={MONTHLY_CAP_AED}
          aria-valuenow={Math.round(spendAed)}
          aria-label="Monthly AI spend against cap"
        >
          <div
            className={`h-full rounded-full ${capTone} transition-[width]`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-xl font-semibold">Agents</h2>
        <div className="overflow-hidden rounded-xl border border-sand bg-white/75">
          {agents.map((agent) => {
            const on = enabled[agent.key] ?? false;
            return (
              <div
                key={agent.key}
                className="grid gap-3 border-b border-sand/70 p-4 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{agent.name}</h3>
                    <span className="font-mono text-[11px] text-muted">
                      {agent.key}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{agent.purpose}</p>
                </div>
                <div className="flex items-center gap-4 md:justify-end">
                  <div className="text-right">
                    <p className="font-medium">{formatAed(agent.spendAed)}</p>
                    <p className="text-xs text-muted">
                      {agent.runs.toLocaleString("en-AE")} runs
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${on ? "Disable" : "Enable"} ${agent.name}`}
                    className={`relative h-7 w-12 rounded-full transition ${on ? "bg-ochre" : "bg-zinc-300"}`}
                    onClick={() =>
                      setEnabled((current) => ({
                        ...current,
                        [agent.key]: !on,
                      }))
                    }
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-6" : "left-1"}`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-xl font-semibold">Recent runs</h2>
        <div className="overflow-x-auto rounded-xl border border-sand bg-white/75">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-sand text-left text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                <th className="p-3">Agent</th>
                <th className="p-3">Model</th>
                <th className="p-3 text-right">Tokens</th>
                <th className="p-3 text-right">Cost</th>
                <th className="p-3">Gate</th>
                <th className="p-3 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-sand/70 last:border-b-0">
                  <td className="p-3 font-medium">{run.agent}</td>
                  <td className="p-3 font-mono text-xs text-muted">
                    {run.model}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted">
                    {(run.tokensIn + run.tokensOut).toLocaleString("en-AE")}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {formatAed(run.costAed)}
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${GATE_TONE[run.gate]}`}
                    >
                      {run.gate}
                    </span>
                  </td>
                  <td className="p-3 text-right text-muted">
                    {formatRelative(run.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
