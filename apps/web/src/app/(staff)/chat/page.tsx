"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatReadyStrip } from "@/components/chat-ready-strip";
import { nextLinksFromChatObservation } from "@/lib/agent-next-links";
import { trpc } from "@/lib/trpc";
import { observationLooksFailed, toolVerb } from "./tool-meta";

type Effort = "low" | "medium" | "high" | "xhigh";
type HarnessMode = "react" | "direct";

const STARTERS = [
  "Summarize open pipeline deals that need a next action",
  "What delivery tasks are blocked on QC?",
  "Draft a warm outreach opener for a Dubai hospitality lead",
  "Advance this client’s funnel drafts (brief, campaign, portal invite)",
  "List my unread notifications and tickets",
] as const;

const OS_SETTLE_STARTER =
  "Run closed loop then settle OS: finance approve and issue invoice, approve outreach, lock the brief then creative QC pass then advance, approve portal, approve campaign and publish campaign, sign off onboarding phase, advance month1, ref-approve calendar.";

function StepFold({
  steps,
}: {
  steps: Array<Record<string, unknown>> | undefined;
}) {
  if (!steps?.length) return null;
  const tools = steps.filter((s) => typeof s.toolName === "string");
  if (!tools.length) return null;
  return (
    <details className="hrmny-chat-workfold" data-testid="chat-work-steps" open>
      <summary>
        Worked · {tools.length} tool{tools.length === 1 ? "" : "s"}
      </summary>
      <ol className="hrmny-chat-tool-list">
        {tools.map((s, i) => {
          const name = String(s.toolName);
          const failed = observationLooksFailed(s.observation);
          const nextLinks = Array.isArray(s.nextLinks)
            ? (s.nextLinks as Array<{ href: string; label: string }>).filter(
                (l) =>
                  typeof l?.href === "string" &&
                  l.href.startsWith("/") &&
                  typeof l?.label === "string",
              )
            : nextLinksFromChatObservation(s.observation);
          return (
            <li
              key={i}
              className={`hrmny-chat-tool-row${failed ? " is-failed" : " is-ok"}`}
              data-testid={`chat-tool-${name}`}
            >
              <strong>{toolVerb(name, "done")}</strong>
              <span className="hrmny-chat-tool-id">{name}</span>
              {s.observation ? (
                <span
                  className="hrmny-chat-tool-detail"
                  data-testid="chat-tool-observation"
                >
                  {String(s.observation).slice(0, 2400)}
                </span>
              ) : null}
              {nextLinks.length > 0 ? (
                <p
                  className="hrmny-chat-tool-next"
                  data-testid="chat-tool-next"
                >
                  {nextLinks.map((link) => (
                    <Link
                      key={`${link.label}-${link.href}`}
                      href={link.href}
                      className="hrmny-chat-next-chip"
                      data-testid={`chat-next-${link.label}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
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
  const runtimeLlm = trpc.chat.runtimeLlm.useQuery(undefined, {
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
    if (threadId) return;
    // Match sandbox AND agent so selecting os-settle cannot be overwritten by
    // an older org thread (which would drop agent_act from the harness).
    const preferred = (threads.data ?? []).find(
      (t) =>
        (t.clientId ?? "") === clientId &&
        (t.agentSlug ?? "") === agentSlug,
    );
    if (preferred) setThreadId(preferred.chatThreadId);
  }, [threadId, threads.data, clientId, agentSlug]);

  const activeThread = threads.data?.find((t) => t.chatThreadId === threadId);

  useEffect(() => {
    if (!activeThread) return;
    // Keep React selects in sync with the bound thread — but never clobber a
    // newer agent/sandbox choice that intentionally cleared threadId.
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

  const selectedAgent = useMemo(
    () => (agents.data ?? []).find((a) => a.slug === agentSlug),
    [agents.data, agentSlug],
  );
  const sandboxClient = useMemo(
    () => (clients.data ?? []).find((c) => c.clientId === clientId),
    [clients.data, clientId],
  );
  const toolsPreview = useMemo(() => {
    if (
      selectedAgent &&
      "toolsPreview" in selectedAgent &&
      Array.isArray(selectedAgent.toolsPreview)
    ) {
      return selectedAgent.toolsPreview as string[];
    }
    return [] as string[];
  }, [selectedAgent]);
  const toolCount =
    selectedAgent &&
    "toolCount" in selectedAgent &&
    typeof selectedAgent.toolCount === "number"
      ? selectedAgent.toolCount
      : toolsPreview.length;

  const agentBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents.data ?? []) {
      map.set(a.slug, a.displayName);
    }
    return map;
  }, [agents.data]);
  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients.data ?? []) {
      map.set(c.clientId, c.name);
    }
    return map;
  }, [clients.data]);

  const activeTitle = useMemo(
    () =>
      threads.data?.find((t) => t.chatThreadId === threadId)?.title ??
      "New conversation",
    [threads.data, threadId],
  );

  const bindingLabel = selectedAgent
    ? selectedAgent.displayName
    : "Default Hrmny agent";
  const sandboxLabel = sandboxClient?.name ?? "Staff / org scope";

  function submit(text: string, harnessOverride?: HarnessMode) {
    const content = text.trim();
    if (!content) return;
    const mode = harnessOverride ?? harness;
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
              harness: mode,
            });
          },
        },
      );
      return;
    }
    send.mutate({ threadId, content, effort, harness: mode });
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
              <small>Agents</small>
            </div>
          </div>
        </div>
        {runtimeLlm.data ? (
          <p className="hrmny-chat-runtime-llm" data-testid="chat-runtime-llm">
            {runtimeLlm.data.provider} · {runtimeLlm.data.defaultModel}
            {runtimeLlm.data.freeOnly ? " · free" : ""}
          </p>
        ) : null}
        <ChatReadyStrip />

        <button
          type="button"
          className="hrmny-chat-new"
          data-testid="chat-new"
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

        <div className="hrmny-chat-bind-sidebar">
          <label className="hrmny-chat-bind-label">
            Agent
            <select
              className="hrmny-chat-bind-select"
              data-testid="chat-agent-slug"
              value={agentSlug}
              onChange={(e) => {
                const next = e.target.value;
                setAgentSlug(next);
                // Agent binding is per-thread. Changing it starts a fresh
                // session so the selection is never a no-op.
                if ((activeThread?.agentSlug ?? "") !== next) {
                  setThreadId(null);
                }
              }}
            >
              <option value="">Default Hrmny agent</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.customAgentId} value={a.slug}>
                  {a.displayName}
                  {"toolCount" in a && typeof a.toolCount === "number"
                    ? ` · ${a.toolCount} tools`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {agentSlug ? (
            <p
              className="hrmny-chat-bind-hint"
              data-testid="chat-agent-hint"
            >
              Bound to this agent&apos;s prompt + allowlisted CRM/OS tools
              {selectedAgent?.model
                ? ` · ${selectedAgent.model}`
                : " · free OpenRouter model"}
              . New chat or send binds the session.
              {toolsPreview.length ? (
                <>
                  <br />
                  <span
                    className="hrmny-chat-tools-preview"
                    data-testid="chat-agent-tools-preview"
                  >
                    {toolsPreview.join(", ")}
                    {toolCount > toolsPreview.length
                      ? ` +${toolCount - toolsPreview.length}`
                      : ""}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
          <label className="hrmny-chat-bind-label">
            Client sandbox
            <select
              className="hrmny-chat-bind-select"
              data-testid="chat-sandbox-client"
              value={clientId}
              onChange={(e) => {
                const next = e.target.value;
                setClientId(next);
                if ((activeThread?.clientId ?? "") !== next) {
                  setThreadId(null);
                }
              }}
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

        <p className="hrmny-chat-section">Sessions</p>
        <ul className="hrmny-chat-sessions">
          {(threads.data ?? []).map((t) => {
            const agentLabel = t.agentSlug
              ? (agentBySlug.get(t.agentSlug) ?? t.agentSlug)
              : "Default";
            const clientLabel = t.clientId
              ? (clientNameById.get(t.clientId) ?? "Client")
              : "Org";
            const isActive = threadId === t.chatThreadId;
            const isWorking = isActive && send.isPending;
            return (
              <li key={t.chatThreadId}>
                <button
                  type="button"
                  className={
                    isActive
                      ? "hrmny-chat-session is-active"
                      : "hrmny-chat-session"
                  }
                  onClick={() => setThreadId(t.chatThreadId)}
                >
                  <span className="hrmny-chat-session-title">
                    {isWorking ? (
                      <span
                        className="hrmny-chat-working-dot"
                        aria-hidden
                      />
                    ) : null}
                    {t.title}
                  </span>
                  <span className="hrmny-chat-session-meta">
                    {agentLabel} · {clientLabel}
                  </span>
                </button>
              </li>
            );
          })}
          {(threads.data?.length ?? 0) === 0 ? (
            <li className="hrmny-chat-empty-side">No sessions yet</li>
          ) : null}
        </ul>
      </aside>

      <section className="hrmny-chat-main">
        <header className="hrmny-chat-header">
          <div>
            <p className="hrmny-chat-kicker">Hrmny chat</p>
            <h1>{activeTitle}</h1>
          </div>
          <div className="hrmny-chat-pills">
            <span data-testid="chat-pill-agent">{bindingLabel}</span>
            <span data-testid="chat-pill-sandbox">{sandboxLabel}</span>
            <span>{harness === "react" ? "ReAct" : "Direct"}</span>
            <span>Effort · {effort}</span>
          </div>
        </header>

        <div
          className="hrmny-chat-context-banner"
          data-testid="chat-context-banner"
        >
          <div>
            <p className="hrmny-chat-context-title">
              {bindingLabel}
              {toolCount > 0 ? (
                <span className="hrmny-chat-context-count">
                  {" "}
                  · {toolCount} tools
                </span>
              ) : null}
            </p>
            <p className="hrmny-chat-context-sub">
              Sandbox: {sandboxLabel}. Agents call CRM, delivery, portal, and
              finance tools inside this scope.
            </p>
          </div>
          {toolsPreview.length ? (
            <ul className="hrmny-chat-context-chips" aria-label="Allowlisted tools">
              {toolsPreview.map((tool) => (
                <li key={tool}>{tool}</li>
              ))}
              {toolCount > toolsPreview.length ? (
                <li>+{toolCount - toolsPreview.length}</li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <div className="hrmny-chat-transcript" ref={scroller}>
          {!threadId || (messages.data?.length ?? 0) === 0 ? (
            <div className="hrmny-chat-welcome">
              <h2>What should {bindingLabel} work on?</h2>
              <p>
                Hrmny plans, calls allowlisted CRM/OS tools, observes results,
                then answers — scoped to {sandboxLabel}
                {toolCount > 0 ? ` · ${toolCount} tools bound` : ""}.
              </p>
              <div className="hrmny-chat-starters">
                {!clientId ? (
                  <button
                    type="button"
                    data-testid="chat-starter-os-settle"
                    // Direct harness always runs agent_act for the bound
                    // allowlist (mock ReAct can pick sibling org tools first).
                    onClick={() => submit(OS_SETTLE_STARTER, "direct")}
                    disabled={send.isPending || create.isPending}
                  >
                    {OS_SETTLE_STARTER.slice(0, 72)}…
                  </button>
                ) : null}
                {STARTERS.filter((s) =>
                  s.includes("funnel drafts") ? Boolean(clientId) : true,
                ).map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-testid={
                      s.includes("funnel drafts")
                        ? "chat-starter-funnel"
                        : "chat-starter"
                    }
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
                    data-testid={
                      m.role === "assistant"
                        ? "chat-assistant-message"
                        : "chat-user-message"
                    }
                  >
                    <div className="hrmny-chat-msg-role">
                      {m.role === "user"
                        ? "You"
                        : selectedAgent?.displayName ?? "Hrmny"}
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
                <article
                  className="hrmny-chat-msg is-assistant is-working"
                  data-testid="chat-live-work"
                >
                  <div className="hrmny-chat-msg-role">
                    {selectedAgent?.displayName ?? "Hrmny"}
                  </div>
                  <div className="hrmny-chat-msg-body">
                    <div className="hrmny-chat-live-dock">
                      <span className="hrmny-chat-working-dot" />
                      Working · calling CRM/OS tools…
                    </div>
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
              Mode
              <select
                value={harness}
                onChange={(e) => setHarness(e.target.value as HarnessMode)}
              >
                <option value="react">ReAct</option>
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
              placeholder={`Message ${bindingLabel}…`}
              data-testid="chat-composer"
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
              data-testid="chat-send"
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
