"use client";

import Link from "next/link";
import { Button } from "@hrmny/ui";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { formatRelative } from "@/components/crm/format";
import { HitlReadyBanner } from "@/components/hitl-ready-banner";
import { DraftPreview } from "./draft-preview";
import { KIND_LABELS, type ApprovalItem, type ApprovalKind } from "./types";

type Feedback = { tone: "ok" | "blocked"; text: string; reconnect?: boolean };

const KIND_TONE: Record<ApprovalKind, string> = {
  outreach_send: "bg-amber-100 text-amber-800",
  campaign_publish: "bg-sky-100 text-sky-800",
  portal_item: "bg-emerald-100 text-emerald-800",
};

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsInner />
    </Suspense>
  );
}

function ApprovalsInner() {
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const focusIdFromQuery = searchParams.get("id")?.trim() || "";
  const clientIdFromQuery = searchParams.get("clientId")?.trim() || "";
  // Outreach drafts awaiting a human send (leadgen router, gate: draft→approved→sent).
  const outreach = trpc.leadgen.outreach.list.useQuery({ state: "draft" });
  const client = trpc.clients.get.useQuery(
    { id: clientIdFromQuery },
    { enabled: Boolean(clientIdFromQuery) && !focusIdFromQuery },
  );
  const resolvedClientOutreachId = useMemo(() => {
    if (focusIdFromQuery || !clientIdFromQuery) return null;
    const dealId =
      client.data && "dealId" in client.data
        ? (client.data.dealId as string | null | undefined)
        : null;
    if (!dealId) return null;
    return (
      (outreach.data ?? []).find((o) => o.dealId === dealId)?.id ?? null
    );
  }, [client.data, clientIdFromQuery, focusIdFromQuery, outreach.data]);
  const focusId = focusIdFromQuery || resolvedClientOutreachId || null;
  // Campaign items approved and awaiting publish (campaigns router, gate: approved→published).
  const campaigns = trpc.campaigns.list.useQuery();
  // Items sitting in the client portal awaiting client sign-off — staff-visible, no staff action.
  const portal = trpc.campaigns.pendingApproval.useQuery();

  const approveOutreach = trpc.leadgen.outreach.approve.useMutation();
  const sendOutreach = trpc.leadgen.outreach.send.useMutation();
  const discardOutreach = trpc.leadgen.outreach.discard.useMutation();
  const moveCampaign = trpc.campaigns.transition.useMutation();

  const [selectedId, setSelectedId] = useState<string | null>(focusIdFromQuery || null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [latestFeedbackId, setLatestFeedbackId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

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
      .filter((v) => v.state === "pending_client" || v.state === "rejected")
      .map((v) => ({
        id: v.campaignItemId,
        kind: "portal_item" as const,
        title: v.title,
        summary:
          v.state === "rejected"
            ? `${v.channel} — client requested changes.${v.feedback ? ` Feedback: ${v.feedback}` : ""}`
            : `${v.channel} item awaiting client sign-off in the portal.${v.feedback ? ` Client note: ${v.feedback}` : ""}`,
        target: v.clientId ? `Portal · ${v.clientId}` : "Client portal",
        agent: "creative",
        meta: v.channel,
        proposedAt: v.scheduledFor || "",
        draft: v.title,
        portalState: v.state as "pending_client" | "rejected",
      }));

    const merged = [...outreachItems, ...campaignItems, ...portalItems].sort(
      (a, b) => b.proposedAt.localeCompare(a.proposedAt),
    );
    if (!focusId) return merged;
    return [...merged].sort((a, b) => {
      if (a.id === focusId) return -1;
      if (b.id === focusId) return 1;
      return 0;
    });
  }, [outreach.data, campaigns.data, portal.data, focusId]);

  const isLoading =
    outreach.isLoading || campaigns.isLoading || portal.isLoading;
  const error = outreach.error ?? campaigns.error ?? portal.error;

  const selected =
    queue.find((i) => i.id === selectedId) ??
    (focusId ? queue.find((i) => i.id === focusId) : undefined) ??
    queue[0] ??
    null;
  const outreachCount = queue.filter((i) => i.kind === "outreach_send").length;
  const actedCount = Object.keys(feedback).length;
  const latestFeedback = latestFeedbackId
    ? feedback[latestFeedbackId]
    : undefined;

  function recordFeedback(id: string, next: Feedback) {
    setFeedback((current) => ({ ...current, [id]: next }));
    setLatestFeedbackId(id);
  }

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
          recordFeedback(item.id, {
            tone: "blocked",
            text: `Approve blocked (${approved.code})`,
          });
          return;
        }
        const sent = await sendOutreach.mutateAsync({ id: item.id });
        recordFeedback(
          item.id,
          sent.ok
            ? {
                tone: "ok",
                text: sent.copyDraft
                  ? `Copy draft ready${sent.sendMode ? ` · ${sent.sendMode}` : ""} — paste manually; still approved`
                  : `Sent${sent.sendMode ? ` · ${sent.sendMode}` : ""}${
                      sent.externalId ? ` · ${sent.externalId}` : ""
                    }`,
              }
            : {
                tone: "blocked",
                text: `Send blocked (${sent.code})`,
                reconnect: true,
              },
        );
        await utils.leadgen.outreach.list.invalidate();
      } else if (item.kind === "campaign_publish") {
        const res = await moveCampaign.mutateAsync({ id: item.id, to: "published" });
        recordFeedback(
          item.id,
          res.ok
            ? {
                tone: "ok",
                text:
                  res.item.publishMode === "live"
                    ? `Published · live${
                        res.item.publishExternalId
                          ? ` · ${res.item.publishExternalId}`
                          : ""
                      }`
                    : `Published · stub (OS only — connect LinkedIn for live)`,
              }
            : {
                tone: "blocked",
                text: res.reason,
                reconnect: /connect|oauth|composio|linkedin|gmail|workspace/i.test(
                  res.reason,
                ),
              },
        );
        await utils.campaigns.list.invalidate();
        await utils.campaigns.pendingApproval.invalidate();
      }
      advanceFrom(item.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed";
      recordFeedback(item.id, {
        tone: "blocked",
        text: message,
        reconnect: /connect|oauth|revoked|precondition|workspace|linkedin|gmail/i.test(
          message,
        ),
      });
    } finally {
      setBusyId(null);
    }
  }

  // Campaigns reject → archived; outreach reject → discarded (leadgen.discard).
  async function reject(item: ApprovalItem) {
    if (item.kind === "portal_item") return;
    setBusyId(item.id);
    try {
      if (item.kind === "outreach_send") {
        const res = await discardOutreach.mutateAsync({ id: item.id });
        recordFeedback(
          item.id,
          res.ok
            ? { tone: "ok", text: "Discarded" }
            : { tone: "blocked", text: `Discard blocked (${res.code})` },
        );
        await utils.leadgen.outreach.list.invalidate();
        advanceFrom(item.id);
        return;
      }
      const res = await moveCampaign.mutateAsync({ id: item.id, to: "archived" });
      recordFeedback(
        item.id,
        res.ok
          ? { tone: "ok", text: "Archived" }
          : { tone: "blocked", text: res.reason },
      );
      await utils.campaigns.list.invalidate();
      await utils.campaigns.pendingApproval.invalidate();
      advanceFrom(item.id);
    } catch (e) {
      recordFeedback(item.id, {
        tone: "blocked",
        text: e instanceof Error ? e.message : "Failed",
      });
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
          {selected ? (
            <p className="sr-only" data-testid="approvals-active-id">
              {selected.id}
            </p>
          ) : null}
          <p className="mt-2 max-w-3xl text-sm text-muted">
            AI proposes; a human disposes. Nothing is sent, published, or shared
            with a client until you approve it here — every decision is a gated
            action with an audit trail.
          </p>
        </div>
      </header>

      <HitlReadyBanner testIdPrefix="approvals" />

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

      {latestFeedback ? (
        <div
          data-testid="approvals-feedback"
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            latestFeedback.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <p>{latestFeedback.text}</p>
          {latestFeedback.reconnect ? (
            <p className="mt-1">
              <Link
                href="/settings/connections"
                className="font-semibold underline"
              >
                Reconnect in Connections →
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

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
                    data-testid={`approvals-item-${item.id}`}
                    data-selected={item.id === selected?.id ? "true" : undefined}
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

              <div className="mt-auto flex flex-wrap gap-2">
                {selected.kind === "portal_item" ? (
                  <p className="text-sm text-muted">
                    {selected.portalState === "rejected"
                      ? "Client requested changes — revise the campaign and resend to the portal."
                      : "Awaiting client sign-off in the portal — no staff action."}
                  </p>
                ) : (
                  <>
                    <Button
                      type="button"
                      data-testid="approvals-approve"
                      disabled={busyId === selected.id}
                      onClick={() => void approve(selected)}
                    >
                      {selected.kind === "outreach_send"
                        ? "Approve & send"
                        : "Approve & publish"}
                    </Button>
                    {selected.kind === "campaign_publish" ||
                    selected.kind === "outreach_send" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busyId === selected.id}
                        onClick={() => void reject(selected)}
                      >
                        {selected.kind === "outreach_send"
                          ? "Discard"
                          : "Reject"}
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
