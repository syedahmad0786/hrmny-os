"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

type Effort = "low" | "medium" | "high" | "xhigh";
type HarnessMode = "react" | "direct";

const STARTERS = [
  "Summarize open pipeline deals that need a next action",
  "What delivery tasks are blocked on QC?",
  "Draft a warm outreach opener for a Dubai hospitality lead",
  "Advance this client’s funnel drafts (brief, campaign, portal invite)",
  "List my unread notifications and tickets",
] as const;

function StepFold({
  steps,
}: {
  steps: Array<Record<string, unknown>> | undefined;
}) {
  if (!steps?.length) return null;
  const tools = steps.filter((s) => typeof s.toolName === "string");
  if (!tools.length) return null;
  return (
    <details className="hrmny-chat-workfold">
      <summary>
        Worked · {tools.length} tool{tools.length === 1 ? "" : "s"}
      </summary>
      <ol>
        {tools.map((s, i) => (
          <li key={i}>
            <strong>{String(s.toolName)}</strong>
            {s.observation ? (
              <span>{String(s.observation).slice(0, 240)}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function HrmnyChatPage() {
  const utils = trpc.useUtils();
  const threads = trpc.chat.listThreads.useQuery();
  const agents = trpc.chat.listRunnableAgents.useQuery(undefined, {
    staleTime: 60_000,
  });
  const clients = trpc.clients.list.useQuery(undefined, { staleTime: 60_000 });
  const [agentSlug, setAgentSlug] = useState("");
  const [clientId, setClientId] = useState("");
  const create = trpc.chat.createThread.useMutation({
    onSuccess: (row) => {
      void utils.chat.listThreads.invalidate();
      setThreadId(row.chatThreadId);
    },
  });
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [effort, setEffort] = useState<Effort>("medium");
  const [harness, setHarness] = useState<HarnessMode>("react");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const messages = trpc.chat.messages.useQuery(
    { threadId: threadId! },
    { enabled: Boolean(threadId) },
  );
  const send = trpc.chat.send.useMutation({
    onSuccess: () => {
      void utils.chat.messages.invalidate();
      void utils.chat.listThreads.invalidate();
      setDraft("");
    },
  });

  useEffect(() => {
    if (!threadId && threads.data?.[0]) {
      setThreadId(threads.data[0].chatThreadId);
    }
  }, [threadId, threads.data]);

  const activeThread = threads.data?.find((t) => t.chatThreadId === threadId);

  useEffect(() => {
    if (!activeThread) return;
    setClientId(activeThread.clientId ?? "");
    setAgentSlug(activeThread.agentSlug ?? "");
  }, [
    activeThread?.chatThreadId,
    activeThread?.clientId,
    activeThread?.agentSlug,
  ]);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.data, send.isPending]);

  const activeTitle = useMemo(
    () =>
      threads.data?.find((t) => t.chatThreadId === threadId)?.title ??
      "New conversation",
    [threads.data, threadId],
  );

  function submit(text: string) {
    const content = text.trim();
    if (!content) return;
    if (!threadId) {
      create.mutate(
        {
          title: content.slice(0, 60),
          agentSlug: agentSlug || undefined,
          clientId: clientId || undefined,
        },
        {
          onSuccess: (row) => {
            setThreadId(row.chatThreadId);
            send.mutate({
              threadId: row.chatThreadId,
              content,
              effort,
              harness,
            });
          },
        },
      );
      return;
    }
    send.mutate({ threadId, content, effort, harness });
  }

  return (
    <div className={`hrmny-chat${sidebarOpen ? "" : " is-rail"}`}>
      <aside className="hrmny-chat-sidebar" aria-label="Conversations">
        <div className="hrmny-chat-brand">
          <button
            type="button"
            className="hrmny-chat-rail-toggle"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="hrmny-chat-brand-lockup">
            <span className="hrmny-chat-mark">h</span>
            <div>
              <strong>Hrmny</strong>
              <small>Agent harness</small>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="hrmny-chat-new"
          disabled={create.isPending}
          onClick={() =>
            create.mutate({
              title: "New chat",
              agentSlug: agentSlug || undefined,
              clientId: clientId || undefined,
            })
          }
        >
          <span>+</span>
          <span>New chat</span>
        </button>

        <div className="mx-3 mb-2 space-y-2">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Agent
            <select
              className="mt-1 w-full rounded border border-sand bg-white px-2 py-1.5 text-xs text-ink"
              value={agentSlug}
              onChange={(e) => setAgentSlug(e.target.value)}
            >
              <option value="">Default harness</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.customAgentId} value={a.slug}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Client sandbox
            <select
              className="mt-1 w-full rounded border border-sand bg-white px-2 py-1.5 text-xs text-ink"
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
          </label>
        </div>

        <p className="hrmny-chat-section">Personal</p>
        <ul className="hrmny-chat-sessions">
          {(threads.data ?? []).map((t) => (
            <li key={t.chatThreadId}>
              <button
                type="button"
                className={
                  threadId === t.chatThreadId
                    ? "hrmny-chat-session is-active"
                    : "hrmny-chat-session"
                }
                onClick={() => setThreadId(t.chatThreadId)}
              >
                <span className="hrmny-chat-session-title">{t.title}</span>
                <span className="hrmny-chat-session-meta">{t.harness}</span>
              </button>
            </li>
          ))}
          {(threads.data?.length ?? 0) === 0 ? (
            <li className="hrmny-chat-empty-side">No sessions yet</li>
          ) : null}
        </ul>

        <p className="hrmny-chat-attrib">
          Shell patterned after{" "}
          <a
            href="https://github.com/yc-software/qm"
            target="_blank"
            rel="noreferrer"
          >
            QM
          </a>
          , rebranded for Hrmny.
        </p>
      </aside>

      <section className="hrmny-chat-main">
        <header className="hrmny-chat-header">
          <div>
            <p className="hrmny-chat-kicker">Conversation</p>
            <h1>{activeTitle}</h1>
          </div>
          <div className="hrmny-chat-pills">
            {activeThread?.agentSlug ? (
              <span>Agent · {activeThread.agentSlug}</span>
            ) : null}
            {activeThread?.clientId ? <span>Client sandbox</span> : null}
            <span>{harness === "react" ? "ReAct" : "Direct"}</span>
            <span>Effort · {effort}</span>
          </div>
        </header>

        <div className="hrmny-chat-transcript" ref={scroller}>
          {!threadId || (messages.data?.length ?? 0) === 0 ? (
            <div className="hrmny-chat-welcome">
              <h2>What should Hrmny work on?</h2>
              <p>
                Personal workspace with a QM-style harness — plan, call tools,
                observe, answer. Scoped to your staff session.
              </p>
              <div className="hrmny-chat-starters">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    disabled={send.isPending || create.isPending}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="hrmny-chat-messages">
              {(messages.data ?? []).map((m) => {
                const meta = (m.metadata ?? {}) as {
                  steps?: Array<Record<string, unknown>>;
                  provider?: string;
                };
                return (
                  <article
                    key={m.chatMessageId}
                    className={`hrmny-chat-msg is-${m.role}`}
                  >
                    <div className="hrmny-chat-msg-role">
                      {m.role === "user" ? "You" : "Hrmny"}
                    </div>
                    <div className="hrmny-chat-msg-body">
                      {m.role === "assistant" ? (
                        <StepFold steps={meta.steps} />
                      ) : null}
                      <p>{m.content}</p>
                    </div>
                  </article>
                );
              })}
              {send.isPending ? (
                <article className="hrmny-chat-msg is-assistant is-working">
                  <div className="hrmny-chat-msg-role">Hrmny</div>
                  <div className="hrmny-chat-msg-body">
                    <span className="hrmny-chat-working-dot" />
                    Working…
                  </div>
                </article>
              ) : null}
            </div>
          )}
          {send.error ? (
            <p className="hrmny-chat-error">{send.error.message}</p>
          ) : null}
        </div>

        <form
          className="hrmny-chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <div className="hrmny-chat-composer-toolbar">
            <label>
              Harness
              <select
                value={harness}
                onChange={(e) => setHarness(e.target.value as HarnessMode)}
              >
                <option value="react">ReAct (QM-style)</option>
                <option value="direct">Direct</option>
              </select>
            </label>
            <label>
              Effort
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value as Effort)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">xHigh</option>
              </select>
            </label>
          </div>
          <div className="hrmny-chat-composer-row">
            <textarea
              rows={2}
              placeholder="Message Hrmny…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(draft);
                }
              }}
              disabled={send.isPending}
            />
            <button
              type="submit"
              disabled={send.isPending || !draft.trim()}
              aria-label="Send"
            >
              ↑
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
