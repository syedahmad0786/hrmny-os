"use client";

import { Button } from "@hrmny/ui";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export default function ChatPage() {
  const utils = trpc.useUtils();
  const threads = trpc.chat.listThreads.useQuery();
  const create = trpc.chat.createThread.useMutation({
    onSuccess: (row) => {
      void utils.chat.listThreads.invalidate();
      setThreadId(row.chatThreadId);
    },
  });
  const [threadId, setThreadId] = useState<string | null>(null);
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
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!threadId && threads.data?.[0]) {
      setThreadId(threads.data[0].chatThreadId);
    }
  }, [threadId, threads.data]);

  return (
    <main className="flex min-h-[70vh] flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            AI · Harness
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Chat</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            OpenRouter-backed ReAct loop (plan → tool → observe). Falls back to
            mock when credits or keys are unavailable.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => create.mutate({ title: "New chat" })}
          disabled={create.isPending}
        >
          New thread
        </Button>
      </header>

      <div className="grid flex-1 gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-xl border border-sand bg-white/75 p-2">
          {(threads.data ?? []).length === 0 ? (
            <p className="p-3 text-sm text-muted">No threads yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {(threads.data ?? []).map((t) => (
                <li key={t.chatThreadId}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                      threadId === t.chatThreadId
                        ? "bg-ink text-white"
                        : "hover:bg-cream"
                    }`}
                    onClick={() => setThreadId(t.chatThreadId)}
                  >
                    <span className="line-clamp-1 font-medium">{t.title}</span>
                    <span
                      className={`mt-0.5 block text-[10px] uppercase tracking-wide ${
                        threadId === t.chatThreadId
                          ? "text-white/70"
                          : "text-muted"
                      }`}
                    >
                      {t.harness}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="flex flex-col rounded-xl border border-sand bg-white/75">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!threadId ? (
              <p className="text-sm text-muted">Start a thread to chat.</p>
            ) : messages.isLoading ? (
              <p className="text-sm text-muted">Loading messages…</p>
            ) : (messages.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">
                Ask about a client, deal, or delivery task. The harness can call
                memory search tools.
              </p>
            ) : (
              (messages.data ?? []).map((m) => (
                <div
                  key={m.chatMessageId}
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "ml-auto bg-ink text-white"
                      : "bg-cream text-ink"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))
            )}
            {send.error ? (
              <p className="text-sm text-red-700">{send.error.message}</p>
            ) : null}
          </div>
          <form
            className="flex gap-2 border-t border-sand p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!threadId || !draft.trim()) return;
              send.mutate({ threadId, content: draft.trim() });
            }}
          >
            <input
              className="flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              placeholder="Message the harness…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!threadId || send.isPending}
            />
            <Button type="submit" disabled={!threadId || send.isPending}>
              {send.isPending ? "Thinking…" : "Send"}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
