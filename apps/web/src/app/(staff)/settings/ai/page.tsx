"use client";

import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/root";
import { formatAed, formatRelative } from "@/components/crm/format";
import { PlatformReadyStrip } from "@/components/platform-ready-strip";
import { nextLinksFromToolResults } from "@/lib/agent-next-links";

type Dashboard = inferRouterOutputs<AppRouter>["aiAdmin"]["dashboard"];
type AgentKey = Dashboard["agents"][number]["key"];

type GateOutcome = "approved" | "pending" | "rejected" | "auto";

const OS_SETTLE_TOOLS = new Set([
  "crm.closed_loop",
  "finance.os_approve",
  "clients.os_month1_advance",
]);

function hasOsSettleTool(tools: readonly string[] | null | undefined) {
  return (tools ?? []).some((tool) => OS_SETTLE_TOOLS.has(tool));
}

const GATE_TONE: Record<GateOutcome, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  auto: "bg-sky-100 text-sky-800",
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-800",
};

function AdminNav() {
  return (
    <nav className="flex flex-wrap gap-2 text-sm" aria-label="Admin settings">
      <Link className="rounded-full bg-ink px-4 py-2 text-white" href="/settings/ai">
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
  );
}

export default function AiAdminPage() {
  const utils = trpc.useUtils();
  const dashboard = trpc.aiAdmin.dashboard.useQuery({ runsLimit: 20 });
  const clients = trpc.clients.list.useQuery(undefined, { staleTime: 60_000 });
  const [clientId, setClientId] = useState("");
  const toggle = trpc.aiAdmin.toggleAgent.useMutation({
    onSuccess: () => void utils.aiAdmin.dashboard.invalidate(),
  });
  const run = trpc.aiAdmin.runAgent.useMutation({
    onSuccess: () => void utils.aiAdmin.dashboard.invalidate(),
  });

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
            Kill switches, on-command runs with client/user memory sandboxes, and
            the cost ledger. Cap fails closed.
          </p>
        </div>
        <AdminNav />
      </header>

      {dashboard.data?.llm ? (
        <p
          className="text-xs text-muted"
          data-testid="ai-runtime-llm"
        >
          Runtime LLM: {dashboard.data.llm.provider} ·{" "}
          {dashboard.data.llm.defaultModel}
          {dashboard.data.llm.freeOnly ? " · free routes only" : ""}
        </p>
      ) : null}

      <PlatformReadyStrip testId="ai-platform-ready" showTools />

      <section className="rounded-xl border border-sand bg-white/75 p-4">
        <label className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
          Memory sandbox client
        </label>
        <select
          data-testid="ai-sandbox-client"
          className="mt-2 w-full max-w-md rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="">Staff / org scope</option>
          {(clients.data ?? []).map((c) => (
            <option key={c.clientId} value={c.clientId}>
              {c.name}
            </option>
          ))}
        </select>
        {clientId ? (
          <p className="mt-2 text-xs text-muted" data-testid="ai-sandbox-hint">
            Client sandbox applies to funnel agent runs. OS settle tools stay
            org-scoped (sandbox cleared on Run).
          </p>
        ) : null}
      </section>

      {dashboard.isLoading ? (
        <div className="rounded-xl border border-sand bg-white/60 p-10 text-center text-sm text-muted">
          Loading AI control panel…
        </div>
      ) : dashboard.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <p className="font-medium">Couldn’t load the AI control panel.</p>
          <p className="mt-1">{dashboard.error.message}</p>
          <button
            type="button"
            className="mt-3 rounded-full border border-red-300 bg-white px-4 py-1.5 font-medium"
            onClick={() => void dashboard.refetch()}
          >
            Retry
          </button>
        </div>
      ) : dashboard.data ? (
        <AiAdminBody
          data={dashboard.data}
          onToggle={(agentId, enabled) => toggle.mutate({ agentId, enabled })}
          togglingId={toggle.isPending ? toggle.variables?.agentId : undefined}
          onRun={(agentId) =>
            run.mutate({
              agentId,
              prompt: clientId
                ? `Demo run for ${agentId} on client sandbox — summarize next onboarding and creative actions.`
                : `Demo run for ${agentId} — summarize next actions.`,
              clientId: clientId || undefined,
            })
          }
          runningId={run.isPending ? run.variables?.agentId : undefined}
          lastRun={run.data ?? null}
          runError={run.error?.message}
        />
      ) : null}

      <CustomAgentsPanel clientId={clientId} />
    </main>
  );
}

function AiAdminBody({
  data,
  onToggle,
  togglingId,
  onRun,
  runningId,
  lastRun,
  runError,
}: {
  data: Dashboard;
  onToggle: (agentId: AgentKey, enabled: boolean) => void;
  togglingId: AgentKey | undefined;
  onRun: (agentId: AgentKey) => void;
  runningId: AgentKey | undefined;
  lastRun: inferRouterOutputs<AppRouter>["aiAdmin"]["runAgent"] | null;
  runError?: string;
}) {
  const { agents, runs, monthlyCapAed } = data;
  const spendAed = agents.reduce((sum, a) => sum + a.spendAed, 0);
  const activeCount = agents.filter((a) => a.enabled).length;
  const pct = monthlyCapAed ? Math.min(100, (spendAed / monthlyCapAed) * 100) : 0;
  const capTone =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-ochre";

  return (
    <>
      <section className="rounded-xl border border-sand bg-white/75 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
              Monthly spend
            </p>
            <p className="mt-1 font-display text-3xl font-semibold">
              {formatAed(spendAed)}{" "}
              {monthlyCapAed ? (
                <span className="text-base font-normal text-muted">
                  of {formatAed(monthlyCapAed)}
                </span>
              ) : null}
            </p>
          </div>
          <p className="text-sm text-muted">
            {monthlyCapAed
              ? `${formatAed(monthlyCapAed - spendAed)} remaining · `
              : "No monthly cap configured · "}
            {activeCount}/{agents.length} agents on
          </p>
        </div>
        {monthlyCapAed ? (
          <div
            className="mt-3 h-3 w-full overflow-hidden rounded-full bg-sand/60"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={monthlyCapAed}
            aria-valuenow={Math.round(spendAed)}
            aria-label="Monthly AI spend against cap"
          >
            <div
              className={`h-full rounded-full ${capTone} transition-[width]`}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        {runError ? (
          <p className="mt-3 text-sm text-red-700">{runError}</p>
        ) : null}
        {lastRun ? (
          <div className="mt-3 space-y-2" data-testid="ai-admin-last-run">
            <p className="text-sm text-muted">
              Last run:{" "}
              <span className="font-medium text-ink">{lastRun.agent}</span> ·{" "}
              {lastRun.gateOutcome} · {formatAed(lastRun.costAed)}
            </p>
            {"output" in lastRun && lastRun.output != null ? (
              <pre
                data-testid="ai-admin-last-run-output"
                className="max-h-32 overflow-auto rounded-lg bg-ink/5 p-3 text-xs"
              >
                {typeof lastRun.output === "string"
                  ? lastRun.output
                  : JSON.stringify(lastRun.output, null, 2)}
              </pre>
            ) : null}
            {"toolResults" in lastRun &&
            Array.isArray(lastRun.toolResults) &&
            lastRun.toolResults.length > 0 ? (
              <>
                <ul
                  data-testid="ai-admin-last-run-tools"
                  className="rounded-lg border border-sand bg-white/70 p-3 text-xs"
                >
                  <li className="mb-1 font-semibold uppercase tracking-[0.12em] text-muted">
                    Tool results
                  </li>
                  {lastRun.toolResults.map(
                    (
                      row: {
                        tool?: string;
                        ok?: boolean;
                        error?: string;
                        data?: unknown;
                      },
                      idx: number,
                    ) => (
                      <li key={`${row.tool ?? "tool"}-${idx}`}>
                        <span className="font-mono">{row.tool ?? "?"}</span>
                        {" · "}
                        {row.ok
                          ? "ok"
                          : `failed${row.error ? `: ${row.error}` : ""}`}
                      </li>
                    ),
                  )}
                </ul>
                {(() => {
                  const links = nextLinksFromToolResults(lastRun.toolResults);
                  if (!links.length) return null;
                  return (
                    <p
                      className="flex flex-wrap gap-2 text-sm"
                      data-testid="ai-admin-last-run-next"
                    >
                      {links.map((link) => (
                        <Link
                          key={`${link.label}-${link.href}`}
                          href={link.href}
                          className="text-ochre underline"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </p>
                  );
                })()}
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 font-display text-xl font-semibold">Agents</h2>
        <div className="overflow-hidden rounded-xl border border-sand bg-white/75">
          {agents.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">
              No agents registered.
            </p>
          ) : (
            agents.map((agent) => {
              const busy = togglingId === agent.key;
              const running = runningId === agent.key;
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
                  <div className="flex items-center gap-3 md:justify-end">
                    <div className="text-right">
                      <p className="font-medium">{formatAed(agent.spendAed)}</p>
                      <p className="text-xs text-muted">
                        {agent.runs.toLocaleString("en-AE")} runs
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!agent.enabled || running}
                      className="rounded-full border border-sand bg-white px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                      onClick={() => onRun(agent.key)}
                    >
                      {running ? "Running…" : "Run"}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={agent.enabled}
                      disabled={busy}
                      aria-label={`${agent.enabled ? "Disable" : "Enable"} ${agent.name}`}
                      className={`relative h-7 w-12 rounded-full transition disabled:opacity-50 ${agent.enabled ? "bg-ochre" : "bg-zinc-300"}`}
                      onClick={() => onToggle(agent.key, !agent.enabled)}
                    >
                      <span
                        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${agent.enabled ? "left-6" : "left-1"}`}
                      />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-xl font-semibold">Recent runs</h2>
        <div className="overflow-x-auto rounded-xl border border-sand bg-white/75">
          {runs.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">
              No agent runs recorded yet.
            </p>
          ) : (
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
                  <tr
                    key={run.id}
                    className="border-b border-sand/70 last:border-b-0"
                  >
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
          )}
        </div>
      </section>
    </>
  );
}

function CustomAgentsPanel({ clientId }: { clientId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.aiAdmin.customAgents.list.useQuery();
  const create = trpc.aiAdmin.customAgents.create.useMutation({
    onSuccess: () => {
      void utils.aiAdmin.customAgents.list.invalidate();
      setSlug("");
      setName("");
      setPrompt("");
    },
  });
  const update = trpc.aiAdmin.customAgents.update.useMutation({
    onSuccess: () => void utils.aiAdmin.customAgents.list.invalidate(),
  });
  const remove = trpc.aiAdmin.customAgents.remove.useMutation({
    onSuccess: () => void utils.aiAdmin.customAgents.list.invalidate(),
  });
  const repair = trpc.aiAdmin.customAgents.repairEmptyAllowlists.useMutation({
    onSuccess: () => void utils.aiAdmin.customAgents.list.invalidate(),
  });
  const pruneTest = trpc.aiAdmin.customAgents.pruneTestAgents.useMutation({
    onSuccess: () => void utils.aiAdmin.customAgents.list.invalidate(),
  });
  const runCustom = trpc.aiAdmin.customAgents.run.useMutation({
    onSuccess: () => void utils.aiAdmin.dashboard.invalidate(),
  });
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [toolPreset, setToolPreset] = useState<"funnel" | "demo_os_settle">(
    "funnel",
  );
  const [runPrompt, setRunPrompt] = useState(
    "Summarize next onboarding and creative actions for this client sandbox.",
  );
  const [taskId, setTaskId] = useState("");

  return (
    <section className="rounded-xl border border-sand bg-white/75 p-4">
      <h2 className="font-display text-xl font-semibold">Custom agents</h2>
      <p className="mt-1 text-sm text-muted">
        Create, modify, remove, and run agents on command with client/user/task
        memory sandboxes. Client-sandbox runs are read-only even when the agent
        catalog lists draft tools. OS settle actions require an explicit org-only
        Run with no client sandbox. Mock LLM when OpenRouter credits are empty.
      </p>
      {(list.data ?? []).some((a) => a.toolsEmpty) ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-ink">
          <p>
            Some agents still have an empty tool allowlist (runtime falls back to
            funnel defaults). Persist defaults to the vault.
          </p>
          <button
            type="button"
            className="rounded-full border border-ink/20 bg-white px-3 py-1 text-xs font-medium disabled:opacity-40"
            disabled={repair.isPending}
            onClick={() => repair.mutate()}
          >
            {repair.isPending ? "Repairing…" : "Restore funnel tools"}
          </button>
          {repair.data ? (
            <span className="text-xs text-muted">
              Repaired {repair.data.repaired} ({repair.data.mode})
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          data-testid="ai-agent-prune-test"
          className="rounded-full border border-ink/20 bg-white px-3 py-1 text-xs font-medium disabled:opacity-40"
          disabled={pruneTest.isPending}
          onClick={() => pruneTest.mutate()}
        >
          {pruneTest.isPending ? "Pruning…" : "Prune test agents"}
        </button>
        <span className="text-xs text-muted">
          Removes proof-agent-*, e2e-cmd-*, e2e-os-* (keeps Delivery coach & OS
          settle).
        </span>
        {pruneTest.data ? (
          <span className="text-xs text-muted">
            Removed {pruneTest.data.removed.length} ({pruneTest.data.mode})
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <input
          data-testid="ai-agent-slug"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          placeholder="slug (e.g. brand-voice)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <input
          data-testid="ai-agent-name"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          data-testid="ai-agent-create"
          className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={!slug.trim() || !name.trim() || create.isPending}
          onClick={() =>
            create.mutate({
              slug: slug.trim(),
              displayName: name.trim(),
              systemPrompt: prompt.trim() || undefined,
              toolPreset,
            })
          }
        >
          Create agent
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Tool preset">
        <button
          type="button"
          data-testid="ai-agent-preset-funnel"
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            toolPreset === "funnel"
              ? "bg-ink text-white"
              : "border border-sand bg-white text-ink"
          }`}
          onClick={() => {
            setToolPreset("funnel");
            setRunPrompt(
              "Summarize next onboarding and creative actions for this client sandbox.",
            );
          }}
        >
          Funnel catalog
        </button>
        <button
          type="button"
          data-testid="ai-agent-preset-os-settle"
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            toolPreset === "demo_os_settle"
              ? "bg-ink text-white"
              : "border border-sand bg-white text-ink"
          }`}
          onClick={() => {
            setToolPreset("demo_os_settle");
            setRunPrompt(
              "Run closed loop then settle OS: finance approve and issue invoice, approve outreach, creative QC pass then advance to client review, approve campaign and publish campaign, sign off onboarding phase, advance month1, ref-approve calendar.",
            );
          }}
        >
          OS settle tools
        </button>
        <span className="self-center text-xs text-muted">
          {toolPreset === "demo_os_settle"
            ? "Run with no client sandbox (org-only gates)."
            : "Client runs are policy-filtered to reads."}
        </span>
      </div>
      <textarea
        data-testid="ai-agent-system-prompt"
        className="mt-2 min-h-[72px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
        placeholder="System prompt (optional)"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <textarea
          data-testid="ai-agent-run-prompt"
          className="min-h-[56px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          placeholder="Run prompt for on-command invoke"
          value={runPrompt}
          onChange={(e) => setRunPrompt(e.target.value)}
        />
        <input
          data-testid="ai-agent-task-id"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm font-mono"
          placeholder="Optional task UUID sandbox"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
        />
      </div>
      {create.error ? (
        <p className="mt-2 text-sm text-red-700">{create.error.message}</p>
      ) : null}
      {runCustom.data ? (
        <div className="mt-3 space-y-2" data-testid="ai-agent-run-output">
          <pre className="max-h-40 overflow-auto rounded-lg bg-ink/5 p-3 text-xs">
            {typeof runCustom.data.output === "string"
              ? runCustom.data.output
              : JSON.stringify(runCustom.data.output, null, 2)}
          </pre>
          {"toolResults" in runCustom.data &&
          Array.isArray(runCustom.data.toolResults) &&
          runCustom.data.toolResults.length > 0 ? (
            <ul
              data-testid="ai-agent-tool-results"
              className="rounded-lg border border-sand bg-white/70 p-3 text-xs"
            >
              <li className="mb-1 font-semibold uppercase tracking-[0.12em] text-muted">
                Tool results
              </li>
              {runCustom.data.toolResults.map(
                (
                  row: {
                    tool?: string;
                    ok?: boolean;
                    error?: string;
                    data?: unknown;
                  },
                  idx: number,
                ) => (
                  <li
                    key={`${row.tool ?? "tool"}-${idx}`}
                    data-testid={`ai-agent-tool-${row.tool ?? "unknown"}`}
                  >
                    <span className="font-mono">{row.tool ?? "?"}</span>
                    {" · "}
                    {row.ok
                      ? "ok"
                      : `failed${row.error ? `: ${row.error}` : ""}`}
                    {row.data != null ? (
                      <pre
                        data-testid="ai-agent-tool-result-data"
                        className="mt-1 max-h-28 overflow-auto rounded bg-ink/5 p-2 font-mono text-[11px] text-ink/80"
                      >
                        {typeof row.data === "string"
                          ? row.data
                          : JSON.stringify(row.data)}
                      </pre>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          ) : null}
          {(() => {
            const rows =
              "toolResults" in runCustom.data &&
              Array.isArray(runCustom.data.toolResults)
                ? runCustom.data.toolResults
                : [];
            const links = nextLinksFromToolResults(rows);
            if (!links.length) return null;
            return (
              <p
                className="flex flex-wrap gap-2 text-sm"
                data-testid="ai-agent-run-next"
              >
                {links.map((link) => (
                  <Link
                    key={`${link.label}-${link.href}`}
                    href={link.href}
                    className="text-ochre underline"
                  >
                    {link.label}
                  </Link>
                ))}
              </p>
            );
          })()}
        </div>
      ) : null}
      {runCustom.error ? (
        <p className="mt-2 text-sm text-red-700">{runCustom.error.message}</p>
      ) : null}
      <ul className="mt-4 divide-y divide-sand">
        {(list.data ?? []).map((agent) => (
          <li
            key={agent.customAgentId}
            data-testid={`ai-agent-row-${agent.slug}`}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="font-medium">
                {agent.displayName}{" "}
                <span className="font-mono text-xs text-muted">
                  {agent.slug}
                </span>
              </p>
              <p className="text-xs text-muted">
                {agent.enabled ? "enabled" : "disabled"} ·{" "}
                {agent.model ?? "default model"} ·{" "}
                {agent.toolsEmpty
                  ? "catalog empty (runtime defaults, policy-filtered)"
                  : `${agent.effectiveAllowedTools?.length ?? 0} catalog entries`}
              </p>
              {!agent.toolsEmpty &&
              Array.isArray(agent.effectiveAllowedTools) &&
              agent.effectiveAllowedTools.length > 0 ? (
                <p className="mt-1 max-w-xl font-mono text-[10px] text-muted">
                  {agent.effectiveAllowedTools.slice(0, 8).join(", ")}
                  {agent.effectiveAllowedTools.length > 8
                    ? ` +${agent.effectiveAllowedTools.length - 8}`
                    : ""}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid={`ai-agent-run-${agent.slug}`}
                className="rounded-full border border-sand bg-white px-3 py-1.5 text-xs disabled:opacity-40"
                disabled={!agent.enabled || runCustom.isPending || !runPrompt.trim()}
                onClick={() => {
                  const hasOsSettle = hasOsSettleTool(
                    agent.effectiveAllowedTools,
                  );
                  runCustom.mutate({
                    id: agent.customAgentId,
                    prompt: runPrompt.trim(),
                    // OS settle tools are org-only; skip client sandbox when preset tools present
                    clientId: hasOsSettle ? undefined : clientId || undefined,
                    taskId: taskId.trim() || undefined,
                  });
                }}
              >
                {clientId &&
                !hasOsSettleTool(agent.effectiveAllowedTools)
                  ? "Run read-only"
                  : "Run"}
                {clientId &&
                (agent.effectiveAllowedTools ?? []).some((t) =>
                  ["crm.closed_loop", "finance.os_approve"].includes(t),
                )
                  ? " (org)"
                  : ""}
              </button>
              <button
                type="button"
                className="rounded-full border border-sand bg-white px-3 py-1.5 text-xs"
                onClick={() =>
                  update.mutate({
                    id: agent.customAgentId,
                    enabled: !agent.enabled,
                  })
                }
              >
                {agent.enabled ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700"
                onClick={() => remove.mutate({ id: agent.customAgentId })}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
