"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
  CrmTag,
} from "@/components/crm/ui";
import {
  buafScore,
  formatAed,
  formatLane,
  formatRelative,
} from "@/components/crm/format";
import { AiDealPanel } from "../../_components/ai-deal-panel";

const NEXT: Record<string, string> = {
  discover: "qualify",
  qualify: "engage",
  engage: "scope",
  scope: "propose",
  propose: "price_cost",
  price_cost: "close",
  close: "handover_pack",
};

export default function CrmDealDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const utils = trpc.useUtils();
  const deal = trpc.crm.deals.get.useQuery({ id });
  const activities = trpc.crm.activities.list.useQuery({ dealId: id, limit: 50 });
  const notes = trpc.crm.notes.list.useQuery({ dealId: id });
  const tasks = trpc.crm.tasks.list.useQuery({ dealId: id });

  const update = trpc.crm.deals.update.useMutation({
    onSuccess: () => void utils.crm.invalidate(),
  });
  const move = trpc.crm.deals.moveStage.useMutation({
    onSuccess: () => void utils.crm.invalidate(),
  });
  const closeDeal = trpc.crm.deals.close.useMutation({
    onSuccess: () => void utils.crm.invalidate(),
  });
  const handover = trpc.crm.deals.handoverPack.useMutation({
    onSuccess: () => {
      void utils.crm.invalidate();
      void utils.clients.invalidate();
      void utils.tasks.invalidate();
    },
  });
  const logActivity = trpc.crm.activities.create.useMutation({
    onSuccess: () => void utils.crm.activities.invalidate(),
  });
  const addNote = trpc.crm.notes.create.useMutation({
    onSuccess: () => void utils.crm.notes.invalidate(),
  });

  const d = deal.data;
  const [budget, setBudget] = useState(false);
  const [urgency, setUrgency] = useState(false);
  const [access, setAccess] = useState(false);
  const [fit, setFit] = useState(false);
  const [temp, setTemp] = useState<"hot" | "warm" | "cool" | "cold" | "">("");
  const [note, setNote] = useState("");
  const [last, setLast] = useState<unknown>(null);

  useEffect(() => {
    if (!d) return;
    setBudget(Boolean(d.buafBudget));
    setUrgency(Boolean(d.buafUrgency));
    setAccess(Boolean(d.buafAccess));
    setFit(Boolean(d.buafFit));
    setTemp(d.buafTemperature ?? "");
  }, [d]);

  const score = useMemo(() => (d ? buafScore(d) : null), [d]);
  const nextStage = d?.stage ? NEXT[String(d.stage)] : undefined;

  if (deal.isLoading) {
    return <CrmEmpty title="Loading deal…" />;
  }

  if (!d) {
    return (
      <main>
        <CrmEmpty title="Deal not found" hint="It may have been removed or the id is invalid." />
        <Link href="/crm" className="mt-4 inline-block text-[var(--ochre-dark)]">
          ← Back to pipeline
        </Link>
      </main>
    );
  }

  return (
    <main>
      <CrmPageHeader
        kicker="CRM · Deal detail"
        title={d.companyName}
        description={`${formatLane(d.leadSourceLane)} · ${String(d.stage).replace(/_/g, " ")} · ${formatAed(d.quoteValue)}`}
        actions={
          <>
            <Link href="/crm">
              <CrmBtn>← Pipeline</CrmBtn>
            </Link>
            {nextStage && nextStage !== "handover_pack" ? (
              <CrmBtn
                variant="primary"
                disabled={move.isPending}
                onClick={async () => {
                  const r = await move.mutateAsync({ id, to: nextStage });
                  setLast(r);
                }}
              >
                Advance → {nextStage.replace(/_/g, " ")}
              </CrmBtn>
            ) : null}
            {(d.stage === "price_cost" || d.stage === "close") &&
            d.closeOutcome !== "won" ? (
              <CrmBtn
                variant="primary"
                disabled={closeDeal.isPending}
                onClick={async () => {
                  const r = await closeDeal.mutateAsync({
                    id,
                    outcome: "won",
                  });
                  setLast(r);
                }}
              >
                Mark won
              </CrmBtn>
            ) : null}
            {d.closeOutcome === "won" && d.stage === "close" ? (
              <CrmBtn
                variant="primary"
                disabled={handover.isPending}
                onClick={async () => {
                  const r = await handover.mutateAsync({ id });
                  setLast(r);
                }}
              >
                Handover pack → client
              </CrmBtn>
            ) : null}
            {d.stage === "handover_pack" ? (
              <Link href="/clients">
                <CrmBtn variant="primary">Open clients →</CrmBtn>
              </Link>
            ) : null}
            {handover.data &&
            "ok" in handover.data &&
            handover.data.ok &&
            "client" in handover.data ? (
              <div className="flex flex-wrap gap-2">
                <Link href={`/clients/${handover.data.client.clientId}`}>
                  <CrmBtn variant="primary">Open client onboarding →</CrmBtn>
                </Link>
                {"next" in handover.data && handover.data.next ? (
                  <>
                    <Link href={handover.data.next.account}>
                      <CrmBtn>Account calendar →</CrmBtn>
                    </Link>
                    <Link href={handover.data.next.creative}>
                      <CrmBtn>Creative →</CrmBtn>
                    </Link>
                    <Link href={handover.data.next.approvals}>
                      <CrmBtn>Approvals →</CrmBtn>
                    </Link>
                    {"outreach" in handover.data.next &&
                    handover.data.next.outreach ? (
                      <Link href={handover.data.next.outreach}>
                        <CrmBtn>Outreach draft →</CrmBtn>
                      </Link>
                    ) : null}
                    {"finance" in handover.data.next &&
                    handover.data.next.finance ? (
                      <Link href={handover.data.next.finance}>
                        <CrmBtn>First invoice →</CrmBtn>
                      </Link>
                    ) : null}
                    {handover.data.portalInvite?.portalPath ? (
                      <Link href={handover.data.portalInvite.portalPath}>
                        <CrmBtn>
                          Portal invite (
                          {handover.data.portalInvite.delivery?.mode ?? "mock"})
                          →
                        </CrmBtn>
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        }
      />

      <section className="crm-split">
        <div className="space-y-4">
          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>BUAF qualification</h3>
                <p>Budget · Urgency · Access · Fit</p>
              </div>
              <CrmTag kind={score && score.done === 4 ? "success" : "warn"}>
                {score?.label ?? "—"}
              </CrmTag>
            </div>
            <div className="crm-panel-body">
              <div className="crm-checklist">
                {(
                  [
                    ["Budget", budget, setBudget],
                    ["Urgency", urgency, setUrgency],
                    ["Access / Authority", access, setAccess],
                    ["Fit", fit, setFit],
                  ] as const
                ).map(([label, val, set]) => (
                  <label key={label} className="crm-check-row">
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={(e) => set(e.target.checked)}
                    />
                    {label}
                    <span>{val ? "Confirmed" : "Missing"}</span>
                  </label>
                ))}
              </div>
              <div className="crm-form-grid mt-4">
                <div className="crm-field">
                  <label>Temperature</label>
                  <select
                    className="crm-select"
                    value={temp}
                    onChange={(e) =>
                      setTemp(e.target.value as typeof temp)
                    }
                  >
                    <option value="">Unset</option>
                    <option value="hot">Hot</option>
                    <option value="warm">Warm</option>
                    <option value="cool">Cool</option>
                    <option value="cold">Cold</option>
                  </select>
                </div>
                <div className="crm-field">
                  <label>Email verified</label>
                  <CrmTag kind={d.emailVerified ? "success" : "warn"}>
                    {d.emailVerified ? "Verified" : "Unverified"}
                  </CrmTag>
                </div>
              </div>
              <div className="crm-approval-actions">
                <CrmBtn
                  variant="primary"
                  disabled={update.isPending}
                  onClick={async () => {
                    const r = await update.mutateAsync({
                      id,
                      buafBudget: budget,
                      buafUrgency: urgency,
                      buafAccess: access,
                      buafFit: fit,
                      buafTemperature: temp || null,
                    });
                    setLast(r);
                  }}
                >
                  Save BUAF
                </CrmBtn>
                <CrmBtn
                  disabled={update.isPending || d.emailVerified}
                  onClick={async () => {
                    const r = await update.mutateAsync({
                      id,
                      emailVerified: true,
                    });
                    setLast(r);
                  }}
                >
                  Mark email verified
                </CrmBtn>
              </div>
            </div>
          </div>

          <AiDealPanel dealId={id} />

          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Notes</h3>
                <p>Deal-scoped CRM notes</p>
              </div>
            </div>
            <div className="crm-panel-body">
              <div className="crm-composer">
                <input
                  placeholder="Add a note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <CrmBtn
                  variant="primary"
                  disabled={!note.trim() || addNote.isPending}
                  onClick={() =>
                    void addNote
                      .mutateAsync({ body: note.trim(), dealId: id })
                      .then(() => setNote(""))
                  }
                >
                  Save
                </CrmBtn>
              </div>
              <div className="crm-checklist">
                {(notes.data ?? []).map((n) => (
                  <div key={n.crmNoteId} className="crm-check-row">
                    {n.body}
                    <span>{formatRelative(n.createdAt)}</span>
                  </div>
                ))}
                {(notes.data ?? []).length === 0 ? (
                  <p className="text-[11px] text-[var(--muted)]">No notes yet.</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="crm-panel">
            <div className="crm-panel-head">
              <h3>Commercial</h3>
            </div>
            <div className="crm-panel-body">
              <div className="crm-metric">
                <span className="crm-metric-label">Quote value</span>
                <strong>{formatAed(d.quoteValue)}</strong>
                <small>
                  {"marginPct" in d && d.marginPct
                    ? `Margin ${Number(d.marginPct).toFixed(1)}%`
                    : "Margin redacted for this role"}
                </small>
              </div>
              <div className="crm-checklist mt-3">
                <div className="crm-check-row">
                  Sector <span>{d.sector ?? "—"}</span>
                </div>
                <div className="crm-check-row">
                  Lane <span>{formatLane(d.leadSourceLane)}</span>
                </div>
                <div className="crm-check-row">
                  Updated <span>{formatRelative(d.updatedAt)}</span>
                </div>
              </div>
              <Link href="/crm/quote" className="mt-3 inline-block text-[var(--ochre-dark)] text-[11px] font-bold">
                Open commercial panel →
              </Link>
            </div>
          </div>

          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Activity</h3>
                <p>Deal timeline</p>
              </div>
              <CrmBtn
                variant="ghost"
                onClick={() =>
                  void logActivity.mutateAsync({
                    type: "note",
                    subject: "Manual check-in",
                    dealId: id,
                    companyId: d.companyId,
                  })
                }
              >
                Log
              </CrmBtn>
            </div>
            <div className="crm-panel-body">
              <div className="crm-timeline">
                {(activities.data ?? []).map((a) => (
                  <div key={a.activityId} className="crm-timeline-item">
                    <span className="crm-timeline-dot" />
                    <div>
                      <h4>{a.subject ?? a.type}</h4>
                      <p>{a.body ?? a.type}</p>
                    </div>
                    <time>{formatRelative(a.occurredAt)}</time>
                  </div>
                ))}
              </div>
              {(tasks.data ?? []).length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Linked tasks
                  </p>
                  <div className="crm-checklist">
                    {(tasks.data ?? []).map((t) => (
                      <div key={t.crmTaskId} className="crm-check-row">
                        {t.title}
                        <span>{t.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </section>

      {last ? (
        <pre className="mt-4 overflow-auto rounded-xl border border-[var(--line)] bg-white/70 p-3 text-[10px]">
          {JSON.stringify(last, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}
