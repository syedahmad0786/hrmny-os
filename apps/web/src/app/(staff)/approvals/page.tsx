"use client";

import { Button } from "@hrmny/ui";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatRelative } from "@/components/crm/format";
import { DraftPreview } from "./draft-preview";
import { KIND_LABELS, type ApprovalItem, type ApprovalKind } from "./types";

type Feedback = { tone: "ok" | "blocked"; text: string };

const KIND_TONE: Record<ApprovalKind, string> = {
  outreach_send: "bg-amber-100 text-amber-800",
  campaign_publish: "bg-sky-100 text-sky-800",
  portal_item: "bg-emerald-100 text-emerald-800",
};

export default function ApprovalsPage() {
  const utils = trpc.useUtils();
  // Outreach drafts awaiting a human send (leadgen router, gate: draft→approved→sent).
  const outreach = trpc.leadgen.outreach.list.useQuery({ state: "draft" });
  // Campaign items approved and awaiting publish (campaigns router, gate: approved→published).
  const campaigns = trpc.campaigns.list.useQuery();
  // Items sitting in the client portal awaiting client sign-off — staff-visible, no staff action.
  const portal = trpc.campaigns.pendingApproval.useQuery();

  const approveOutreach = trpc.leadgen.outreach.approve.useMutation();
  const sendOutreach = trpc.leadgen.outreach.send.useMutation();
  const moveCampaign = trpc.campaigns.transition.useMutation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const queue = useMemo<ApprovalItem[]>(() => {
    const outreachItems: ApprovalItem[] = (outreach.data ?? []).map((o) => ({
      id: o.id,
      kind: "outreach_send",
      title: o.subject || `Outreach — ${o.recipient || o.channel}`,
      summary: `Draft ready to send via ${o.channel}${o.recipient ? ` to ${o.recipient}` : ""}.`,
      target: o.recipient || o.channel,
      agent: "outreach-draft",
      meta: o.channel,
      proposedAt: o.createdAt,
      draft: o.body,
    }));

    const campaignItems: ApprovalItem[] = (campaigns.data ?? [])
      .filter((c) => c.status === "approved")
      .map((c) => ({
        id: c.id,
        kind: "campaign_publish",
        title: c.title,
        summary: `${c.channel} campaign${c.scheduledFor ? `, scheduled ${c.scheduledFor}` : ""} — approved and ready to publish.`,
        target: c.channel,
        agent: "creative",
        meta: c.channel,
        proposedAt: c.scheduledFor || "",
        draft: c.title,
      }));

    const portalItems: ApprovalItem[] = (portal.data ?? [])
      .filter((v) => v.state === "pending_client")
      .map((v) => ({
        id: v.campaignItemId,
        kind: "portal_item",
        title: v.title,
        summary: `${v.channel} item awaiting client sign-off in the portal.${v.feedback ? ` Client note: ${v.feedback}` : ""}`,
        target: v.clientId ? `Portal · ${v.clientId}` : "Client portal",
        agent: "creative",
        meta: v.channel,
        proposedAt: v.scheduledFor || "",
        draft: v.title,
      }));

    return [...outreachItems, ...campaignItems, ...portalItems].sort((a, b) =>
      b.proposedAt.localeCompare(a.proposedAt),
    );
  }, [outreach.data, campaigns.data, portal.data]);

  const isLoading =
    outreach.isLoading || campaigns.isLoading || portal.isLoading;
  const error = outreach.error ?? campaigns.error ?? portal.error;

  const selected = queue.find((i) => i.id === selectedId) ?? queue[0] ?? null;
  const outreachCount = queue.filter((i) => i.kind === "outreach_send").length;
  const actedCount = Object.keys(feedback).length;

  function advanceFrom(id: string) {
    const next = queue.find((i) => i.id !== id);
    if (id === selectedId) setSelectedId(next?.id ?? null);
  }

  async function approve(item: ApprovalItem) {
    setBusyId(item.id);
    try {
      if (item.kind === "outreach_send") {
        const approved = await approveOutreach.mutateAsync({ id: item.id });
        if (!approved.ok) {
          setFeedback((f) => ({
            ...f,
            [item.id]: { tone: "blocked", text: `Approve blocked (${approved.code})` },
          }));
          return;
        }
        const sent = await sendOutreach.mutateAsync({ id: item.id });
        setFeedback((f) => ({
          ...f,
          [item.id]: sent.ok
            ? { tone: "ok", text: `Sent${sent.externalId ? ` · ${sent.externalId}` : ""}` }
            : { tone: "blocked", text: `Send blocked (${sent.code})` },
        }));
        await utils.leadgen.outreach.list.invalidate();
      } else if (item.kind === "campaign_publish") {
        const res = await moveCampaign.mutateAsync({ id: item.id, to: "published" });
        setFeedback((f) => ({
          ...f,
          [item.id]: res.ok
            ? { tone: "ok", text: "Published" }
            : { tone: "blocked", text: res.reason },
        }));
        await utils.campaigns.list.invalidate();
        await utils.campaigns.pendingApproval.invalidate();
      }
      advanceFrom(item.id);
    } catch (e) {
      setFeedback((f) => ({
        ...f,
        [item.id]: { tone: "blocked", text: e instanceof Error ? e.message : "Failed" },
      }));
    } finally {
      setBusyId(null);
    }
  }

  // Only campaigns have a real reject path (gate: →archived). Outreach exposes
  // no discard/reject procedure, so those items carry no Reject control.
  async function reject(item: ApprovalItem) {
    if (item.kind !== "campaign_publish") return;
    setBusyId(item.id);
    try {
      const res = await moveCampaign.mutateAsync({ id: item.id, to: "archived" });
      setFeedback((f) => ({
        ...f,
        [item.id]: res.ok
          ? { tone: "ok", text: "Archived" }
          : { tone: "blocked", text: res.reason },
      }));
      await utils.campaigns.list.invalidate();
      await utils.campaigns.pendingApproval.invalidate();
      advanceFrom(item.id);
    } catch (e) {
      setFeedback((f) => ({
        ...f,
        [item.id]: { tone: "blocked", text: e instanceof Error ? e.message : "Failed" },
      }));
    } finally {
      setBusyId(null);
    }
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
          ["Awaiting you", String(queue.length)],
          ["Outreach drafts", String(outreachCount)],
          ["Acted this session", String(actedCount)],
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

      {isLoading ? (
        <div className="rounded-xl border border-sand bg-white/60 p-10 text-center text-sm text-muted">
          Loading the approval inbox…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          <p className="font-medium">Couldn’t load pending approvals.</p>
          <p className="mt-1">{error.message}</p>
          <button
            type="button"
            className="mt-3 rounded-full border border-red-300 bg-white px-4 py-1.5 font-medium"
            onClick={() => {
              void outreach.refetch();
              void campaigns.refetch();
              void portal.refetch();
            }}
          >
            Retry
          </button>
        </div>
      ) : queue.length === 0 ? (
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
            {queue.map((item) => {
              const active = item.id === selected?.id;
              const fb = feedback[item.id];
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
                        {item.meta}
                      </span>
                      {fb ? (
                        <span
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            fb.tone === "ok"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {fb.text}
                        </span>
                      ) : null}
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

              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                {[
                  ["Target", selected.target],
                  ["Agent", selected.agent],
                  ["Channel", selected.meta],
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

              {feedback[selected.id] ? (
                <p
                  className={`text-sm ${
                    feedback[selected.id]!.tone === "ok"
                      ? "text-emerald-700"
                      : "text-red-700"
                  }`}
                >
                  {feedback[selected.id]!.text}
                </p>
              ) : null}

              <div className="mt-auto flex flex-wrap gap-2">
                {selected.kind === "portal_item" ? (
                  <p className="text-sm text-muted">
                    Awaiting client sign-off in the portal — no staff action.
                  </p>
                ) : (
                  <>
                    <Button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void approve(selected)}
                    >
                      {selected.kind === "outreach_send"
                        ? "Approve & send"
                        : "Approve & publish"}
                    </Button>
                    {selected.kind === "campaign_publish" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busyId === selected.id}
                        onClick={() => void reject(selected)}
                      >
                        Reject
                      </Button>
                    ) : null}
                  </>
                )}
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
