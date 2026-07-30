"use client";

import { Button } from "@hrmny/ui";
import { useMemo, useState } from "react";
import { formatAed, formatRelative } from "@/components/crm/format";
import { DraftPreview } from "./draft-preview";
import { KIND_LABELS, useApprovalQueue, type ApprovalKind } from "./mock-data";

type Decision = "approved" | "rejected";

const KIND_TONE: Record<ApprovalKind, string> = {
  outreach_send: "bg-amber-100 text-amber-800",
  campaign_publish: "bg-sky-100 text-sky-800",
  portal_item: "bg-emerald-100 text-emerald-800",
};

export default function ApprovalsPage() {
  const queue = useApprovalQueue();
  // mock local state — real approve/reject is a gate transition via the
  // `approvals` router; decisions here are optimistic and non-persisting.
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [selectedId, setSelectedId] = useState<string | null>(
    queue[0]?.id ?? null,
  );

  const pending = useMemo(
    () => queue.filter((item) => !decisions[item.id]),
    [queue, decisions],
  );
  const selected = queue.find((item) => item.id === selectedId) ?? null;
  const pendingCostAed = pending.reduce((sum, item) => sum + item.costAed, 0);

  function decide(id: string, decision: Decision) {
    setDecisions((current) => ({ ...current, [id]: decision }));
    const next = pending.find((item) => item.id !== id);
    if (id === selectedId) setSelectedId(next?.id ?? null);
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            AI · Human-in-the-loop
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Approval inbox
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            AI proposes; a human disposes. Nothing is sent, published, or shared
            with a client until you approve it here — every decision is a gated
            action with an audit trail.
          </p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Awaiting you", String(pending.length)],
          ["Est. cost pending", formatAed(pendingCostAed)],
          ["Decided this session", String(Object.keys(decisions).length)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-sand bg-white/75 p-4"
          >
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
              {label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      {pending.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand bg-white/60 p-10 text-center">
          <p className="font-display text-xl font-semibold">Inbox zero</p>
          <p className="mt-2 text-sm text-muted">
            No AI-proposed actions are waiting. New drafts from outreach,
            campaigns, and the client portal land here for review.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ul className="flex flex-col gap-3">
            {pending.map((item) => {
              const active = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      active
                        ? "border-ochre bg-white"
                        : "border-sand bg-white/70 hover:bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${KIND_TONE[item.kind]}`}
                      >
                        {KIND_LABELS[item.kind]}
                      </span>
                      <span className="ml-auto text-xs text-muted">
                        {formatRelative(item.proposedAt)}
                      </span>
                    </div>
                    <h3 className="mt-2 font-medium">{item.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">
                      {item.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full bg-sand/60 px-2 py-0.5 font-bold uppercase tracking-[0.1em]">
                        {item.agent}
                      </span>
                      <span className="rounded-full border border-sand px-2 py-0.5 font-medium text-muted">
                        {formatAed(item.costAed)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <section className="flex flex-col gap-4 rounded-xl border border-sand bg-white/75 p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${KIND_TONE[selected.kind]}`}
                  >
                    {KIND_LABELS[selected.kind]}
                  </span>
                  <span className="text-xs text-muted">
                    proposed {formatRelative(selected.proposedAt)}
                  </span>
                </div>
                <h2 className="mt-2 font-display text-xl font-semibold">
                  {selected.title}
                </h2>
                <p className="mt-1 text-sm text-muted">{selected.summary}</p>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Target", selected.target],
                  ["Agent", selected.agent],
                  ["Model", selected.model],
                  ["Est. cost", formatAed(selected.costAed)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">
                  {selected.baseline ? "Proposed edit" : "Draft"}
                </p>
                <DraftPreview proposal={selected} />
              </div>

              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => decide(selected.id, "approved")}
                >
                  Approve &amp; queue send
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => decide(selected.id, "rejected")}
                >
                  Reject
                </Button>
              </div>
            </section>
          ) : (
            <section className="flex items-center justify-center rounded-xl border border-dashed border-sand bg-white/60 p-8 text-sm text-muted">
              Select a proposal to preview it.
            </section>
          )}
        </div>
      )}
    </main>
  );
}
