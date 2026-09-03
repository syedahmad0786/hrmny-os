"use client";

import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useEffect, useState } from "react";

type Row = Record<string, unknown>;

export default function WorkplacePage() {
  const announcements = trpc.workplace.announcements.list.useQuery();
  const knowledge = trpc.workplace.knowledge.list.useQuery();
  const workflows = trpc.workplace.workflows.runs.useQuery();
  const requests = trpc.workplace.serviceRequests.list.useQuery();
  const knowledgeRows = (knowledge.data ?? []) as Row[];

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">Workplace</h1>
        <p className="mt-1 text-sm text-muted">
          Announcements, policies, employee workflows and service requests.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="Announcements" value={announcements.data?.length ?? 0} />
        <Metric
          label="Knowledge articles"
          value={knowledge.data?.length ?? 0}
        />
        <Metric label="My workflows" value={workflows.data?.length ?? 0} />
        <Metric label="Requests" value={requests.data?.length ?? 0} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <List
          title="Announcements"
          rows={(announcements.data ?? []) as Row[]}
          primary="title"
          secondary="status"
        />
        <List
          title="Knowledge Hub"
          rows={knowledgeRows}
          primary="title"
          secondary="category"
        />
        <List
          title="Workflow runs"
          rows={(workflows.data ?? []) as Row[]}
          primary="workflow_name"
          secondary="status"
        />
        <List
          title="Service requests"
          rows={(requests.data ?? []) as Row[]}
          primary="subject"
          secondary="status"
        />
      </section>
      <CompanyBrain rows={knowledgeRows} />
    </main>
  );
}

function CompanyBrain({ rows }: { rows: Row[] }) {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const admin = (session.data?.roles ?? []).some((role) =>
    ["partner", "director", "hr", "admin"].includes(role),
  );
  const published = rows.filter((row) => row.status === "published");
  const [articleId, setArticleId] = useState("");
  const [reviewedHash, setReviewedHash] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: "",
    category: "General",
    body: "",
  });
  useEffect(() => {
    if (!articleId && published[0]) {
      setArticleId(String(published[0]?.knowledge_article_id ?? ""));
    }
  }, [articleId, published]);
  useEffect(() => setReviewedHash(null), [articleId]);

  const preview = trpc.workplace.knowledge.brainPreview.useQuery(
    { articleId },
    { enabled: admin && Boolean(articleId), retry: false },
  );
  const share = trpc.workplace.knowledge.shareWithBrain.useMutation({
    onSuccess: () => {
      setReviewedHash(null);
      void preview.refetch();
    },
  });
  const create = trpc.workplace.knowledge.create.useMutation({
    onSuccess: async (created) => {
      await utils.workplace.knowledge.list.invalidate();
      setArticleId(String(created.knowledge_article_id));
      setDraft({ title: "", category: "General", body: "" });
    },
  });

  return (
    <section className="rounded-xl border border-sand bg-white/75 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            Shared company brain
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">
            Publish reviewed knowledge to GBrain
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Only an already-published HRMNY article can cross this boundary.
            Every share is version-locked, confirmed by an administrator and
            read back from GBrain before it is marked complete.
          </p>
        </div>
        <Link
          href="/settings/connections"
          className="inline-flex min-h-11 items-center rounded-lg border border-sand bg-white px-4 text-sm font-semibold"
        >
          Connection status
        </Link>
      </div>

      {!admin ? (
        <p className="mt-5 rounded-lg bg-cream p-4 text-sm text-muted">
          Published knowledge stays readable in the Knowledge Hub. A partner,
          director or HR administrator controls company-wide brain sharing.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <details className="rounded-lg border border-sand bg-white p-4">
            <summary className="cursor-pointer font-semibold">
              Create and publish an internal article
            </summary>
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const slug =
                  draft.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "") || `knowledge-${Date.now()}`;
                create.mutate({ ...draft, slug, publish: true });
              }}
            >
              <label className="text-sm font-medium">
                Title
                <input
                  className="mt-1 min-h-11 w-full rounded-lg border border-sand px-3"
                  required
                  minLength={2}
                  maxLength={200}
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="text-sm font-medium">
                Category
                <input
                  className="mt-1 min-h-11 w-full rounded-lg border border-sand px-3"
                  required
                  minLength={2}
                  maxLength={100}
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="text-sm font-medium">
                Article content
                <textarea
                  className="mt-1 min-h-40 w-full rounded-lg border border-sand p-3"
                  required
                  maxLength={100_000}
                  value={draft.body}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                />
              </label>
              <p className="text-xs text-muted">
                This publishes inside HRMNY only. GBrain still requires the
                separate review and confirmation below.
              </p>
              <button
                type="submit"
                className="min-h-11 w-fit rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50"
                disabled={create.isPending}
              >
                {create.isPending ? "Publishing…" : "Publish inside HRMNY"}
              </button>
              {create.error ? (
                <p role="alert" className="text-sm text-red-700">
                  {create.error.message}
                </p>
              ) : null}
            </form>
          </details>

          {!published.length ? (
            <p className="rounded-lg bg-cream p-4 text-sm text-muted">
              Publish the first article above; drafts never cross into GBrain.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(15rem,22rem)_1fr]">
              <label className="text-sm font-medium">
                Published article
                <select
                  className="mt-2 min-h-11 w-full rounded-lg border border-sand bg-white px-3"
                  value={articleId}
                  onChange={(event) => setArticleId(event.target.value)}
                >
                  {published.map((row) => (
                    <option
                      key={String(row.knowledge_article_id)}
                      value={String(row.knowledge_article_id)}
                    >
                      {String(row.title)} · v{String(row.current_version)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg border border-sand bg-cream/40 p-4">
                {preview.isLoading ? (
                  <p className="text-sm text-muted">Loading exact version…</p>
                ) : preview.error ? (
                  <p role="alert" className="text-sm text-red-700">
                    {preview.error.message}
                  </p>
                ) : preview.data ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{preview.data.title}</h3>
                        <p className="text-xs text-muted">
                          {preview.data.category} · version{" "}
                          {preview.data.version} ·{" "}
                          {preview.data.bytes.toLocaleString()} bytes
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          preview.data.shared
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {preview.data.shared
                          ? "Verified in GBrain"
                          : preview.data.bridgeStatus.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-3 break-all text-xs text-muted">
                      Destination: {preview.data.slug}
                      <br />
                      Content proof: {preview.data.contentHash}
                    </p>
                    <details className="mt-4 rounded-lg border border-sand bg-white p-3">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Read the exact content being shared
                      </summary>
                      <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm">
                        {preview.data.body}
                      </div>
                    </details>

                    {!preview.data.configured ? (
                      <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        GBrain is not connected yet. Add its MCP URL, scoped
                        access token and source ID before sharing.
                      </p>
                    ) : reviewedHash === preview.data.contentHash ? (
                      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                        <p className="text-sm font-semibold text-amber-950">
                          Confirm company-wide sharing
                        </p>
                        <p className="mt-1 text-sm text-amber-900">
                          This exact version becomes searchable by every GBrain
                          client allowed to read the HRMNY source.
                        </p>
                        <button
                          type="button"
                          className="mt-3 min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50"
                          disabled={share.isPending}
                          onClick={() =>
                            share.mutate({
                              articleId: preview.data.articleId,
                              expectedVersion: preview.data.version,
                              expectedContentHash: preview.data.contentHash,
                              confirmation: "SHARE WITH COMPANY BRAIN",
                            })
                          }
                        >
                          {share.isPending
                            ? "Sharing and verifying…"
                            : "Confirm exact version"}
                        </button>
                        <button
                          type="button"
                          className="ml-2 min-h-11 px-3 text-sm underline"
                          onClick={() => setReviewedHash(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mt-4 min-h-11 rounded-lg border border-sand bg-white px-4 text-sm font-semibold"
                        onClick={() =>
                          setReviewedHash(preview.data.contentHash)
                        }
                      >
                        Review this exact version
                      </button>
                    )}

                    {share.data ? (
                      <p
                        role="status"
                        className="mt-3 text-sm text-emerald-800"
                      >
                        Verified in GBrain. Receipt {share.data.receiptId}.
                      </p>
                    ) : null}
                    {share.error ? (
                      <p role="alert" className="mt-3 text-sm text-red-700">
                        {share.error.message}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-sand bg-white/70 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}

function List({
  title,
  rows,
  primary,
  secondary,
}: {
  title: string;
  rows: Row[];
  primary: string;
  secondary: string;
}) {
  return (
    <section className="rounded-lg border border-sand bg-white/70 p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-sm">
        {rows.length ? (
          rows.slice(0, 8).map((row, index) => (
            <div
              className="flex justify-between border-t border-sand/70 py-2"
              key={String(row.id ?? row[primary] ?? index)}
            >
              <span>{String(row[primary] ?? "Untitled")}</span>
              <span className="text-muted">{String(row[secondary] ?? "")}</span>
            </div>
          ))
        ) : (
          <p className="text-muted">Nothing here yet.</p>
        )}
      </div>
    </section>
  );
}
