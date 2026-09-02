"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@hrmny/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import { OnboardingReadyBanner } from "@/components/onboarding-ready-banner";
import { nextLinksFromToolData } from "@/lib/agent-next-links";
import {
  hasSyntheticMarker,
  isSyntheticAgent,
  isSyntheticRecordName,
} from "@/lib/synthetic-records";

type AgentToolRow = {
  tool?: string;
  ok?: boolean;
  error?: string;
  data?: unknown;
};

const ATTENTION_STATES = new Set(["brief_ready", "qc", "client_review"]);

const humanStatus = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

function DeliveryBoardPageInner() {
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const taskIdFromQuery = searchParams.get("taskId")?.trim() || "";
  const clientIdFromQuery = searchParams.get("clientId")?.trim() || "";
  const board = trpc.dashboards.delivery.useQuery();
  const clients = trpc.clients.list.useQuery();
  const agents = trpc.aiAdmin.customAgents.list.useQuery();
  const runAgent = trpc.aiAdmin.customAgents.run.useMutation();
  const reviewHref = trpc.clients.portalUsers.reviewHref.useMutation();
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const [taskKey, setTaskKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState(
    "Suggest the next delivery action for this task.",
  );
  const [portalMsg, setPortalMsg] = useState<string | null>(null);
  const [showTestRecords, setShowTestRecords] = useState(false);
  const demoResets = showDemoResets();

  const allClientNameById = useMemo(
    () =>
      new Map(
        (clients.data ?? []).map((client) => [client.clientId, client.name]),
      ),
    [clients.data],
  );
  const clientNameById = useMemo(
    () =>
      new Map(
        (clients.data ?? [])
          .filter(
            (client) => showTestRecords || !isSyntheticRecordName(client.name),
          )
          .map((client) => [client.clientId, client.name]),
      ),
    [clients.data, showTestRecords],
  );
  const visibleBoard = useMemo(
    () =>
      (board.data?.board ?? []).map((column) => ({
        ...column,
        tasks: column.tasks.filter(
          (task) =>
            showTestRecords ||
            !hasSyntheticMarker(
              task.title,
              allClientNameById.get(task.clientId),
            ),
        ),
      })),
    [allClientNameById, board.data?.board, showTestRecords],
  );
  const flatTasks = useMemo(
    () =>
      visibleBoard.flatMap((column) =>
        column.tasks.map((task) => ({ ...task, status: column.status })),
      ),
    [visibleBoard],
  );
  const hiddenTestCount = useMemo(
    () =>
      (board.data?.board ?? []).reduce(
        (count, column) =>
          count +
          column.tasks.filter((task) =>
            hasSyntheticMarker(
              task.title,
              allClientNameById.get(task.clientId),
            ),
          ).length,
        0,
      ),
    [allClientNameById, board.data?.board],
  );

  useEffect(() => {
    if (showTestRecords || (!taskIdFromQuery && !clientIdFromQuery)) return;
    const requested = (board.data?.board ?? [])
      .flatMap((column) => column.tasks)
      .find(
        (task) =>
          task.taskId === taskIdFromQuery ||
          task.clientId === clientIdFromQuery,
      );
    if (
      requested &&
      hasSyntheticMarker(
        requested.title,
        allClientNameById.get(requested.clientId),
      )
    ) {
      setShowTestRecords(true);
    }
  }, [
    allClientNameById,
    board.data?.board,
    clientIdFromQuery,
    showTestRecords,
    taskIdFromQuery,
  ]);
  const attentionTasks = flatTasks.filter(
    (task) => ATTENTION_STATES.has(task.status) || task.priority === "urgent",
  );
  const selected = flatTasks.find((task) => task.taskId === taskKey);
  const selectedAgent = (agents.data ?? []).find(
    (agent) => agent.customAgentId === agentId,
  );
  const toolResults =
    runAgent.data &&
    "toolResults" in runAgent.data &&
    Array.isArray(runAgent.data.toolResults)
      ? (runAgent.data.toolResults as AgentToolRow[])
      : [];

  useEffect(() => {
    if (!flatTasks.length || taskKey) return;
    const taskMatch = taskIdFromQuery
      ? flatTasks.find((task) => task.taskId === taskIdFromQuery)
      : null;
    const clientMatch = clientIdFromQuery
      ? (flatTasks.find(
          (task) =>
            task.clientId === clientIdFromQuery &&
            ATTENTION_STATES.has(task.status),
        ) ?? flatTasks.find((task) => task.clientId === clientIdFromQuery))
      : null;
    setTaskKey(
      taskMatch?.taskId ??
        clientMatch?.taskId ??
        attentionTasks[0]?.taskId ??
        flatTasks[0]!.taskId,
    );
  }, [attentionTasks, clientIdFromQuery, flatTasks, taskIdFromQuery, taskKey]);

  function openPortal(next: "/portal/approvals" | "/portal/onboarding") {
    if (!selected?.clientId) return;
    setPortalMsg(null);
    void reviewHref
      .mutateAsync({ clientId: selected.clientId, next })
      .then((data) => window.location.assign(data.portalPath))
      .catch((error: unknown) =>
        setPortalMsg(
          error instanceof Error ? error.message : "Portal link could not open",
        ),
      );
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5">
      <nav
        className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-white p-1"
        aria-label="Delivery sections"
      >
        {(
          [
            ["/delivery", "Overview"],
            ["/work", "Projects"],
            ["/creative", "Creative review"],
            ["/assets", "Assets"],
          ] as const
        ).map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${href === "/delivery" ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--line)] pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">
            Delivery
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
            Move the next client item.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Start with work waiting for a brief, internal review, or a client
            decision. Open the item to see who must move it next.
          </p>
        </div>
        <Link
          href={
            selected?.clientId
              ? `/traffic?clientId=${selected.clientId}`
              : "/traffic"
          }
          className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-paper"
          data-testid="delivery-traffic-link"
        >
          Open next blocked item →
        </Link>
      </header>

      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Delivery summary"
      >
        {[
          ["Needs attention", attentionTasks.length],
          [
            "Waiting on client",
            flatTasks.filter((task) => task.status === "client_review").length,
          ],
          [
            "In creative review",
            flatTasks.filter((task) => task.status === "qc").length,
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-[var(--line)] bg-white p-5"
          >
            <p className="text-xs text-muted">{label}</p>
            <strong className="mt-2 block font-display text-3xl text-ink">
              {value}
            </strong>
          </div>
        ))}
      </section>

      {hiddenTestCount ? (
        <label className="flex w-fit items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showTestRecords}
            onChange={(event) => setShowTestRecords(event.target.checked)}
          />
          {showTestRecords ? "Hide" : "Show"} {hiddenTestCount} test item
          {hiddenTestCount === 1 ? "" : "s"}
        </label>
      ) : null}

      <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink">Delivery board</h2>
            <p className="mt-1 text-sm text-muted">
              Select an item to open its client, creative, or approval path.
            </p>
          </div>
          {selected ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/creative?clientId=${encodeURIComponent(selected.clientId)}&taskId=${encodeURIComponent(selected.taskId)}`}
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                data-testid="delivery-creative-link"
              >
                Creative review
              </Link>
              <Link
                href={`/account?clientId=${encodeURIComponent(selected.clientId)}`}
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                data-testid="delivery-account-link"
              >
                Client plan
              </Link>
              <button
                type="button"
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
                data-testid="delivery-client-portal"
                disabled={reviewHref.isPending}
                onClick={() => openPortal("/portal/approvals")}
              >
                {reviewHref.isPending ? "Opening…" : "Client approvals"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm disabled:opacity-40"
                data-testid="delivery-client-onboarding"
                disabled={reviewHref.isPending}
                onClick={() => openPortal("/portal/onboarding")}
              >
                Onboarding
              </button>
            </div>
          ) : null}
        </div>
        {portalMsg ? (
          <p
            className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {portalMsg}
          </p>
        ) : null}
        {board.isLoading ? (
          <p className="py-12 text-center text-sm text-muted">
            Loading delivery…
          </p>
        ) : flatTasks.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            No client work is waiting. New delivery work appears here after a
            won deal is handed over.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {visibleBoard.map((column) => (
              <section
                key={column.status}
                className="min-w-0 rounded-xl bg-[var(--muted-surface-soft)] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <h3 className="text-xs font-bold text-ink">
                    {humanStatus(column.status)}
                  </h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-muted">
                    {column.tasks.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {column.tasks.map((task) => (
                    <li key={task.taskId}>
                      <button
                        type="button"
                        className={`w-full rounded-lg border bg-white p-3 text-left transition ${task.taskId === taskKey ? "border-ochre shadow-sm" : "border-[var(--line)] hover:border-[var(--line-strong)]"}`}
                        onClick={() => setTaskKey(task.taskId)}
                      >
                        <strong className="block text-sm text-ink">
                          {task.title}
                        </strong>
                        <span className="mt-1 block text-xs text-muted">
                          {clientNameById.get(task.clientId) ?? "Client"} ·{" "}
                          {task.priority ?? "Normal"}
                        </span>
                      </button>
                    </li>
                  ))}
                  {column.tasks.length === 0 ? (
                    <li className="px-2 py-5 text-center text-xs text-muted">
                      Nothing here
                    </li>
                  ) : null}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      <details className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Delivery setup and automation
        </summary>
        <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4">
          <OnboardingReadyBanner testIdPrefix="delivery" />
          {demoResets ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void reset.mutateAsync()}
              disabled={reset.isPending}
            >
              Reset test delivery data
            </Button>
          ) : null}
          <div>
            <h2 className="font-display text-lg text-ink">
              Ask an agent about one task
            </h2>
            <p className="mt-1 text-sm text-muted">
              The agent can only use the selected client and task context. It
              cannot approve or send on your behalf.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <select
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              value={taskKey}
              onChange={(event) => setTaskKey(event.target.value)}
              aria-label="Task"
              data-testid="delivery-task-select"
            >
              <option value="">Select task…</option>
              {flatTasks.map((task) => (
                <option key={task.taskId} value={task.taskId}>
                  {task.title} · {clientNameById.get(task.clientId) ?? "Client"}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              aria-label="Agent"
              data-testid="delivery-agent-select"
            >
              <option value="">Select agent…</option>
              {(agents.data ?? [])
                .filter(
                  (agent) =>
                    agent.enabled &&
                    !isSyntheticAgent({
                      slug: agent.slug,
                      displayName: agent.displayName,
                    }),
                )
                .map((agent) => (
                  <option key={agent.customAgentId} value={agent.customAgentId}>
                    {agent.displayName}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              data-testid="delivery-run-agent"
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
              {runAgent.isPending ? "Working…" : "Ask agent"}
            </button>
          </div>
          {selected || selectedAgent ? (
            <p
              className="text-xs text-muted"
              data-testid="delivery-agent-sandbox-hint"
            >
              Context:{" "}
              {selected
                ? (clientNameById.get(selected.clientId) ?? "Client")
                : "Choose a task"}
              {selected ? (
                <span className="sr-only" data-testid="delivery-sandbox-client">
                  {clientNameById.get(selected.clientId) ?? "Client"}
                </span>
              ) : null}
              {selectedAgent?.effectiveAllowedTools?.length ? (
                <span
                  className="sr-only"
                  data-testid="delivery-agent-allowlist"
                >
                  {selectedAgent.effectiveAllowedTools.join(", ")}
                </span>
              ) : null}
            </p>
          ) : null}
          <textarea
            className="min-h-20 w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="Agent prompt"
            data-testid="delivery-agent-prompt"
          />
          {runAgent.data ? (
            <div className="rounded-lg bg-[var(--muted-surface-soft)] p-3 text-sm">
              <p data-testid="delivery-agent-output">
                {typeof runAgent.data.output === "string"
                  ? runAgent.data.output
                  : JSON.stringify(runAgent.data.output)}
              </p>
              {toolResults.length ? (
                <ul
                  className="mt-3 space-y-2"
                  data-testid="delivery-agent-tool-results"
                >
                  {toolResults.map((row, index) => (
                    <li
                      key={`${row.tool ?? "step"}-${index}`}
                      data-testid={`delivery-agent-tool-${row.tool ?? "unknown"}`}
                    >
                      {row.ok ? "Completed" : "Could not complete"}
                      {row.error ? `: ${row.error}` : ""}
                      {row.data != null ? (
                        <span
                          className="sr-only"
                          data-testid="delivery-agent-tool-result-data"
                        >
                          {JSON.stringify(row.data)}
                        </span>
                      ) : null}
                      {nextLinksFromToolData(row.data).map((link) => (
                        <Link
                          key={`${link.href}-${link.label}`}
                          href={link.href}
                          className="ml-2 text-ochre underline"
                          data-testid="delivery-agent-tool-next"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {runAgent.error ? (
            <p className="text-sm text-red-700" role="alert">
              {runAgent.error.message}
            </p>
          ) : null}
        </div>
      </details>
    </main>
  );
}

export default function DeliveryBoardPage() {
  return (
    <Suspense
      fallback={
        <main className="p-6 text-sm text-muted">Loading delivery…</main>
      }
    >
      <DeliveryBoardPageInner />
    </Suspense>
  );
}
