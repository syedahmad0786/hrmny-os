"use client";

import { useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

export default function WorkSearchPage() {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [saveName, setSaveName] = useState("");
  const projects = trpc.work.projects.list.useQuery();
  const saved = trpc.work.personal.savedSearches.useQuery();
  const results = trpc.work.personal.search.useQuery(
    {
      query,
      projectId: projectId || undefined,
      includeCompleted,
      limit: 100,
    },
    { enabled: Boolean(query.trim()) },
  );
  const save = trpc.work.personal.saveSearch.useMutation({
    onSuccess: async () => {
      setSaveName("");
      await utils.work.personal.savedSearches.invalidate();
    },
  });
  const remove = trpc.work.personal.deleteSearch.useMutation({
    onSuccess: () => utils.work.personal.savedSearches.invalidate(),
  });

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
          Find work
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">Search</h1>
        <p className="mt-2 text-sm text-muted">
          Search task titles and descriptions across every project you can
          access.
        </p>
      </header>
      <section className="grid gap-3 rounded-xl border border-sand bg-white/70 p-4 md:grid-cols-[1fr_14rem_auto]">
        <input
          className="rounded-lg border border-sand bg-white px-3 py-2"
          placeholder="Search work"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="rounded-lg border border-sand bg-white px-3 py-2"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">All projects</option>
          {(projects.data ?? []).map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(event) => setIncludeCompleted(event.target.checked)}
          />
          Completed
        </label>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <section className="overflow-hidden rounded-xl border border-sand bg-white/70">
          {(results.data ?? []).map((task) => (
            <article
              key={task.itemId}
              className="border-b border-sand p-4 last:border-0"
            >
              <p className="font-medium">{task.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">
                {task.description || "No description"}
              </p>
              <p className="mt-2 text-xs text-muted">
                {"projectName" in task ? String(task.projectName) : "Work"}
                {task.dueAt
                  ? ` · ${new Date(task.dueAt).toLocaleDateString()}`
                  : ""}
              </p>
            </article>
          ))}
          {query && !results.isLoading && !results.data?.length ? (
            <p className="p-8 text-center text-sm text-muted">No results.</p>
          ) : null}
        </section>
        <aside className="rounded-xl border border-sand bg-white/70 p-4">
          <h2 className="font-display text-lg">Saved searches</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({
                name: saveName,
                query: {
                  text: query,
                  projectId: projectId || undefined,
                  includeCompleted,
                },
              });
            }}
          >
            <input
              className="min-w-0 flex-1 rounded border border-sand px-2 py-1 text-sm"
              placeholder="Save as…"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
            />
            <button
              className="rounded bg-ink px-3 py-1 text-sm text-white"
              disabled={!query.trim() || !saveName.trim()}
            >
              Save
            </button>
          </form>
          <div className="mt-4 space-y-2">
            {(saved.data ?? []).map((search) => (
              <div
                key={search.savedSearchId}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded border border-sand px-2 py-1 text-left text-sm"
                  onClick={() => {
                    const value = search.query as {
                      text?: string;
                      projectId?: string;
                      includeCompleted?: boolean;
                    };
                    setQuery(value.text ?? "");
                    setProjectId(value.projectId ?? "");
                    setIncludeCompleted(value.includeCompleted ?? true);
                  }}
                >
                  {search.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${search.name}`}
                  onClick={() =>
                    remove.mutate({ savedSearchId: search.savedSearchId })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>
      {results.error || save.error || remove.error ? (
        <p className="text-sm text-red-700">
          {(results.error ?? save.error ?? remove.error)?.message}
        </p>
      ) : null}
    </main>
  );
}
