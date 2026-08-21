"use client";

import { useMemo, useState } from "react";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import { deliveryRhythmFor } from "@/lib/delivery-rhythm";
import Link from "next/link";

export default function DeliveryBoardPage() {
  const utils = trpc.useUtils();
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const board = trpc.dashboards.delivery.useQuery();
  const capacity = trpc.dashboards.capacity.useQuery();
  const clients = trpc.clients.list.useQuery();
  const agents = trpc.aiAdmin.customAgents.list.useQuery();
  const runAgent = trpc.aiAdmin.customAgents.run.useMutation();
  const demoResets = showDemoResets();
  const rhythms = (clients.data ?? []).slice(0, 8).map((c) => ({
    name: c.name,
    ...deliveryRhythmFor(c.engagementType),
  }));

  const flatTasks = useMemo(
    () =>
      (board.data?.board ?? []).flatMap((col) =>
        col.tasks.map((t) => ({
          ...t,
          status: col.status,
        })),
      ),
    [board.data?.board],
  );
  const [taskKey, setTaskKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState(
    "Suggest the next delivery action for this task sandbox.",
  );
  const selected = flatTasks.find((t) => t.taskId === taskKey);

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            Delivery board
          </h1>
          <p className="text-muted">
            Task board · retainer = recurring checkpoints · project = milestone
            touchpoints
          </p>
        </div>
        {demoResets ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void reset.mutateAsync()}
            disabled={reset.isPending}
          >
            Reset M4 demo
          </Button>
        ) : null}
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm font-medium">Contract → delivery rhythm</p>
        <ul className="mt-2 space-y-1 text-sm">
          {rhythms.map((row) => (
            <li key={row.name}>
              <span className="font-medium">{row.name}</span>
              {" — "}
              {row.label}
            </li>
          ))}
          {!rhythms.length ? (
            <li className="text-muted">
              No clients yet — set engagement type on{" "}
              <Link href="/clients" className="underline">
                Clients
              </Link>
              .
            </li>
          ) : null}
        </ul>
      </section>

      <p className="text-sm text-muted">
        Bottleneck:{" "}
        <span className="text-ink">
          {board.data?.bottleneck.status ?? "—"} (
          {board.data?.bottleneck.count ?? 0}) · ratio{" "}
          {board.data?.ratio ?? 0}
        </span>
        {" · "}
        <Link href="/traffic" className="text-ochre underline">
          Traffic / DoR
        </Link>
        {" · "}
        <Link href="/creative" className="text-ochre underline">
          Creative QC
        </Link>
        {" · "}
        <Link href="/portal" className="text-ochre underline">
          Client portal
        </Link>
        {" · "}
        <Link href="/account" className="text-ochre underline">
          Account rhythm
        </Link>
        {" · "}
        <Link href="/assets" className="text-ochre underline">
          Assets
        </Link>
      </p>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Run agent on task</h2>
        <p className="mt-1 text-sm text-muted">
          Invokes a custom agent with client + task memory sandbox (mock LLM if
          OpenRouter credits are empty).
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <select
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={taskKey}
            onChange={(e) => setTaskKey(e.target.value)}
            aria-label="Task"
          >
            <option value="">Select task…</option>
            {flatTasks.map((t) => (
              <option key={t.taskId} value={t.taskId}>
                {t.title} · {t.status}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            aria-label="Agent"
          >
            <option value="">Select agent…</option>
            {(agents.data ?? [])
              .filter((a) => a.enabled)
              .map((a) => (
                <option key={a.customAgentId} value={a.customAgentId}>
                  {a.displayName}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
            disabled={
              !selected || !agentId || !prompt.trim() || runAgent.isPending
            }
            onClick={() =>
              runAgent.mutate({
                id: agentId,
                prompt: prompt.trim(),
                clientId: selected?.clientId,
                taskId: selected?.taskId,
              })
            }
          >
            {runAgent.isPending ? "Running…" : "Run agent"}
          </button>
        </div>
        <textarea
          className="mt-2 min-h-[56px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label="Agent prompt"
        />
        {!agents.data?.length ? (
          <p className="mt-2 text-xs text-muted">
            No custom agents yet — create one in{" "}
            <Link href="/settings/ai" className="underline">
              AI settings
            </Link>
            .
          </p>
        ) : null}
        {runAgent.data ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-ink/5 p-3 text-xs">
            {typeof runAgent.data.output === "string"
              ? runAgent.data.output
              : JSON.stringify(runAgent.data.output, null, 2)}
          </pre>
        ) : null}
        {runAgent.error ? (
          <p className="mt-2 text-sm text-red-700">{runAgent.error.message}</p>
        ) : null}
      </section>

      <section className="overflow-x-auto">
        <div className="flex min-w-max gap-3">
          {(board.data?.board ?? []).map((col) => (
            <div
              key={col.status}
              className="w-44 shrink-0 rounded-lg border border-sand bg-white/70 p-3"
            >
              <p className="font-display text-xs uppercase tracking-wider text-ochre">
                {col.status.replace(/_/g, " ")}
              </p>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {col.tasks.map((t) => (
                  <li
                    key={t.taskId}
                    className="rounded border border-sand/70 bg-paper/80 px-2 py-1.5"
                  >
                    <p className="font-medium leading-snug">{t.title}</p>
                    <p className="text-xs text-muted">
                      {t.priority ?? "—"} · {t.taskType}
                    </p>
                    <button
                      type="button"
                      className="mt-1 text-xs text-ochre underline"
                      onClick={() => setTaskKey(t.taskId)}
                    >
                      Use for agent
                    </button>
                  </li>
                ))}
                {col.tasks.length === 0 ? (
                  <li className="text-xs text-muted">Empty</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Capacity (3 weeks)</h2>
        <ul className="mt-2 grid gap-2 text-sm md:grid-cols-3">
          {(capacity.data?.weeks ?? []).map((w) => (
            <li key={w.weekStart} className="border-t border-sand/60 pt-2">
              <p className="font-medium">{w.weekStart}</p>
              <p className="text-muted">
                assigned {w.assigned} · unassigned {w.unassigned} · in prod{" "}
                {w.inProduction}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
