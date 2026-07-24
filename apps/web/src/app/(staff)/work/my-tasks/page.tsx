"use client";

import { useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

export default function MyTasksPage() {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const tasks = trpc.work.personal.myTasks.useQuery({
    query: query || undefined,
    includeCompleted,
  });
  const complete = trpc.work.tasks.complete.useMutation({
    onSuccess: () => utils.work.personal.myTasks.invalidate(),
  });

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
          Personal work
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">My tasks</h1>
        <p className="mt-2 text-sm text-muted">
          Every task assigned to you across projects, ordered by deadline.
        </p>
      </header>
      <div className="flex flex-wrap gap-3 rounded-xl border border-sand bg-white/70 p-3">
        <input
          className="min-w-64 flex-1 rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          placeholder="Filter my tasks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(event) => setIncludeCompleted(event.target.checked)}
          />
          Show completed
        </label>
      </div>
      <section className="overflow-hidden rounded-xl border border-sand bg-white/70">
        {(tasks.data ?? []).map((task) => (
          <div
            key={`${task.projectId}:${task.itemId}`}
            className="grid gap-3 border-b border-sand px-4 py-3 last:border-0 md:grid-cols-[auto_1fr_12rem_9rem] md:items-center"
          >
            <input
              type="checkbox"
              checked={Boolean(task.completedAt)}
              disabled={complete.isPending}
              onChange={(event) =>
                complete.mutate({
                  itemId: task.itemId,
                  completed: event.target.checked,
                })
              }
            />
            <div>
              <p
                className={
                  task.completedAt ? "line-through text-muted" : "font-medium"
                }
              >
                {task.title}
              </p>
              <p className="text-xs text-muted">
                {"projectName" in task ? String(task.projectName) : "Work"}
              </p>
            </div>
            <span className="text-sm text-muted">
              {task.dueAt
                ? new Date(task.dueAt).toLocaleDateString()
                : "No due date"}
            </span>
            <span className="text-xs font-bold uppercase text-muted">
              {task.priority ?? "normal"}
            </span>
          </div>
        ))}
        {!tasks.isLoading && !tasks.data?.length ? (
          <p className="p-8 text-center text-sm text-muted">
            No matching tasks.
          </p>
        ) : null}
      </section>
      {tasks.error || complete.error ? (
        <p className="text-sm text-red-700">
          {(tasks.error ?? complete.error)?.message}
        </p>
      ) : null}
    </main>
  );
}
