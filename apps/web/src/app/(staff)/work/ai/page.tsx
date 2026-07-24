"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

const capabilities = [
  [
    "smart_chat",
    "Smart chat",
    "Ask a question or propose a task",
    "work.ai.smart_chat",
  ],
  [
    "smart_summaries",
    "Smart summaries",
    "Summarize visible work and actions",
    "work.ai.smart_summaries",
  ],
  [
    "smart_status",
    "Smart status",
    "Draft a sourced project, portfolio, or goal update",
    "work.ai.smart_status",
  ],
  [
    "smart_fields",
    "Smart fields",
    "Suggest a field and classification",
    "work.ai.smart_fields",
  ],
  [
    "smart_editor",
    "Smart editor",
    "Rewrite or improve task text",
    "work.ai.smart_editor",
  ],
  [
    "smart_goals",
    "Smart goals",
    "Draft a measurable goal",
    "work.ai.smart_goals",
  ],
  [
    "smart_projects",
    "Smart projects",
    "Draft a project, sections, and tasks",
    "work.ai.smart_projects",
  ],
  [
    "smart_rules",
    "Smart rules",
    "Draft a safe workflow rule",
    "work.ai.smart_rules",
  ],
  [
    "risk_reports",
    "Risk report",
    "Find blockers, slippage, and mitigations",
    "work.ai.risk_reports",
  ],
  [
    "dash",
    "AI Chief of Staff",
    "Priorities, blockers, and recommended next actions",
    "work.ai.dash",
  ],
] as const;

type Kind = (typeof capabilities)[number][0];
const card = "rounded-xl border border-sand bg-white/80 p-5";

export default function WorkAiPage() {
  const session = trpc.auth.session.useQuery();
  const projects = trpc.work.projects.list.useQuery();
  const history = trpc.workAi.history.useQuery({ limit: 30 });
  const enabled = useMemo(
    () => new Set(session.data?.enabledFeatureKeys ?? []),
    [session.data?.enabledFeatureKeys],
  );
  const available = capabilities.filter(([, , , feature]) =>
    enabled.has(feature),
  );
  const [kind, setKind] = useState<Kind>("smart_chat");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [statusTarget, setStatusTarget] = useState("");
  const [itemId, setItemId] = useState("");
  const [requestText, setRequestText] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [applied, setApplied] = useState<number[]>([]);
  const goals = trpc.work.goals.list.useQuery(undefined, {
    enabled: kind === "smart_status" && enabled.has("work.goals"),
  });
  const portfolios = trpc.work.portfolios.list.useQuery(undefined, {
    enabled: kind === "smart_status" && enabled.has("work.portfolios"),
  });
  const generate = trpc.workAi.generate.useMutation({
    onSuccess: async (run) => {
      setSelectedRunId(run.runId);
      setApplied([]);
      await history.refetch();
    },
  });
  const apply = trpc.workAi.applyAction.useMutation({
    onSuccess: async (_result, variables) => {
      setApplied((current) => [
        ...new Set([...current, variables.actionIndex]),
      ]);
      await history.refetch();
      generate.reset();
    },
  });
  const reject = trpc.workAi.reject.useMutation({
    onSuccess: async () => {
      await history.refetch();
      generate.reset();
    },
  });

  useEffect(() => {
    if (!available.some(([key]) => key === kind) && available[0])
      setKind(available[0][0]);
  }, [available, kind]);

  const generated = generate.data;
  const selected =
    generated?.runId === selectedRunId
      ? generated
      : (history.data?.find((run) => run.runId === selectedRunId) ??
        history.data?.[0]);

  return (
    <main className="flex flex-col gap-6">
      <header className="space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Work · Governed AI
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Work intelligence
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            AI sees only projects you can already open. Answers cite their
            sources, and every proposed change waits for your approval.
          </p>
        </div>
        {enabled.has("work.ai.studio") ? (
          <Link
            className="inline-flex rounded-lg border border-sand bg-white px-4 py-2 text-sm"
            href="/work/ai/studio"
          >
            Open AI Studio
          </Link>
        ) : null}
        {enabled.has("work.ai.teammates") ? (
          <Link
            className="inline-flex rounded-lg border border-sand bg-white px-4 py-2 text-sm"
            href="/work/ai/teammates"
          >
            Open AI Teammates
          </Link>
        ) : null}
        <WorkNav />
      </header>

      {!available.length ? (
        <section className={card}>
          <h2 className="font-display text-xl font-semibold">
            AI is not enabled for your access
          </h2>
          <p className="mt-2 text-sm text-muted">
            An administrator can grant individual AI capabilities in Feature
            Lab.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className={card}>
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                generate.mutate({
                  kind,
                  requestText,
                  projectIds,
                  itemId: itemId.trim() || null,
                  statusTarget:
                    kind === "smart_status" && statusTarget
                      ? {
                          targetType: statusTarget.split(":", 1)[0] as
                            "project" | "portfolio" | "goal",
                          targetId: statusTarget.slice(
                            statusTarget.indexOf(":") + 1,
                          ),
                        }
                      : null,
                });
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Capability</span>
                <select
                  className="w-full rounded-lg border border-sand bg-white px-3 py-2"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as Kind)}
                >
                  {available.map(([key, label, description]) => (
                    <option key={key} value={key}>
                      {label} — {description}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend className="text-sm font-medium">Project context</legend>
                <p className="mt-1 text-xs text-muted">
                  Select only the work this request needs.
                </p>
                <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-sand bg-white p-3 sm:grid-cols-2">
                  {(projects.data ?? []).map((project) => (
                    <label
                      key={project.projectId}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={projectIds.includes(project.projectId)}
                        onChange={() =>
                          setProjectIds((current) =>
                            current.includes(project.projectId)
                              ? current.filter((id) => id !== project.projectId)
                              : [...current, project.projectId].slice(0, 10),
                          )
                        }
                      />
                      <span className="truncate">{project.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {kind === "smart_status" ? (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Status target</span>
                  <select
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2"
                    required
                    value={statusTarget}
                    onChange={(event) => setStatusTarget(event.target.value)}
                  >
                    <option value="">
                      Choose a project, portfolio, or goal
                    </option>
                    {(projects.data ?? []).map((project) => (
                      <option
                        key={`project:${project.projectId}`}
                        value={`project:${project.projectId}`}
                      >
                        Project — {project.name}
                      </option>
                    ))}
                    {(portfolios.data ?? []).map((portfolio) => (
                      <option
                        key={`portfolio:${portfolio.portfolioId}`}
                        value={`portfolio:${portfolio.portfolioId}`}
                      >
                        Portfolio — {portfolio.name}
                      </option>
                    ))}
                    {(goals.data ?? []).map((goal) => (
                      <option
                        key={`goal:${goal.goalId}`}
                        value={`goal:${goal.goalId}`}
                      >
                        Goal — {goal.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted">
                    The draft uses the selected project context as supporting
                    evidence and still waits for your approval.
                  </p>
                </label>
              ) : null}

              {kind === "smart_editor" ? (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">
                    Task ID to edit (optional)
                  </span>
                  <input
                    className="w-full rounded-lg border border-sand bg-white px-3 py-2"
                    value={itemId}
                    onChange={(event) => setItemId(event.target.value)}
                    placeholder="Task UUID"
                  />
                </label>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1 block font-medium">Request</span>
                <textarea
                  className="min-h-36 w-full rounded-lg border border-sand bg-white px-3 py-2"
                  required
                  maxLength={10_000}
                  value={requestText}
                  onChange={(event) => setRequestText(event.target.value)}
                  placeholder={available.find(([key]) => key === kind)?.[2]}
                />
              </label>
              <button
                className="rounded-lg bg-ink px-5 py-2.5 text-sm text-white disabled:opacity-50"
                type="submit"
                disabled={
                  generate.isPending ||
                  !requestText.trim() ||
                  (kind === "smart_status" && !statusTarget)
                }
              >
                {generate.isPending
                  ? "Reviewing accessible work…"
                  : "Generate draft"}
              </button>
              {generate.error ? (
                <p role="alert" className="text-sm text-[var(--hrmny-danger)]">
                  {generate.error.message}
                </p>
              ) : null}
            </form>
          </section>

          <aside className={card}>
            <h2 className="font-display text-xl font-semibold">Recent work</h2>
            <div className="mt-3 space-y-2">
              {(history.data ?? []).map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left text-sm ${selected?.runId === run.runId ? "border-ochre bg-ochre/5" : "border-sand bg-white"}`}
                  onClick={() => {
                    setSelectedRunId(run.runId);
                    setApplied([]);
                  }}
                >
                  <span className="block truncate font-medium">
                    {run.result?.title ?? run.requestText}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {run.kind.replaceAll("_", " ")} · {run.status}
                  </span>
                </button>
              ))}
              {!history.data?.length ? (
                <p className="text-sm text-muted">No AI work yet.</p>
              ) : null}
            </div>
          </aside>
        </div>
      )}

      {selected?.result ? (
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
                {selected.kind.replaceAll("_", " ")} · {selected.status}
              </p>
              <h2 className="mt-1 font-display text-2xl font-semibold">
                {selected.result.title}
              </h2>
            </div>
            {selected.status === "proposed" ? (
              <button
                type="button"
                className="text-sm text-[var(--hrmny-danger)] underline"
                onClick={() => reject.mutate({ runId: selected.runId })}
              >
                Reject all proposals
              </button>
            ) : null}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
            {selected.result.body}
          </p>
          {selected.result.bullets.length ? (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
              {selected.result.bullets.map((bullet, index) => (
                <li key={`${index}-${bullet}`}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          {selected.result.sources.length ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Sources used</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.result.sources.map((source) => (
                  <span
                    key={`${source.type}-${source.id}`}
                    className="rounded-full border border-sand bg-white px-3 py-1 text-xs"
                  >
                    {source.type}: {source.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {selected.result.actions.length ? (
            <div className="mt-6">
              <h3 className="font-display text-xl font-semibold">
                Proposed changes
              </h3>
              <p className="mt-1 text-sm text-muted">
                Review and approve each action separately.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {selected.result.actions.map((action, index) => (
                  <article
                    key={`${action.type}-${index}`}
                    className="rounded-lg border border-sand bg-white p-4"
                  >
                    <p className="text-sm font-semibold">
                      {action.type.replaceAll("_", " ")}
                    </p>
                    <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs text-muted">
                      {JSON.stringify(action, null, 2)}
                    </pre>
                    <button
                      type="button"
                      className="mt-3 rounded-lg bg-ochre px-3 py-2 text-xs text-white disabled:opacity-50"
                      disabled={
                        applied.includes(index) ||
                        apply.isPending ||
                        selected.status === "rejected"
                      }
                      onClick={() =>
                        apply.mutate({
                          runId: selected.runId,
                          actionIndex: index,
                        })
                      }
                    >
                      {applied.includes(index)
                        ? "Applied"
                        : "Approve and apply"}
                    </button>
                  </article>
                ))}
              </div>
              {apply.error ? (
                <p
                  role="alert"
                  className="mt-3 text-sm text-[var(--hrmny-danger)]"
                >
                  {apply.error.message}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="mt-5 text-xs text-muted">
            Provider: {selected.provider ?? "—"} · Model:{" "}
            {selected.model ?? "—"} · Tokens:{" "}
            {(selected.inputTokens ?? 0) + (selected.outputTokens ?? 0)}
          </p>
        </section>
      ) : null}
    </main>
  );
}
