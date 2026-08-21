"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
  CrmTableShell,
  CrmTag,
} from "@/components/crm/ui";
import { formatRelative } from "@/components/crm/format";

/** Serialized shape of a @hrmny/gate TransitionResult refusal. */
type GateOutcome =
  | { ok: true; sendMode?: string; externalId?: string }
  | {
      ok: false;
      code?: string;
      blockedBy?: { gate: string; reason: string }[];
    };

export default function CrmOutreachPage() {
  const utils = trpc.useUtils();
  const items = trpc.leadgen.outreach.list.useQuery();
  const deals = trpc.crm.deals.list.useQuery();

  const [gateError, setGateError] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftDealId, setDraftDealId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const invalidate = () => void utils.leadgen.outreach.invalidate();
  const onErr = (e: { message: string }) => setGateError(e.message);

  const approve = trpc.leadgen.outreach.approve.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const send = trpc.leadgen.outreach.send.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const discard = trpc.leadgen.outreach.discard.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const draft = trpc.leadgen.outreach.draft.useMutation({
    onSuccess: () => {
      setGateError(null);
      setDraftSubject("");
      setDraftBody("");
      invalidate();
    },
    onError: onErr,
  });

  const companyByDeal = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deals.data ?? []) m.set(d.dealId, d.companyName);
    return m;
  }, [deals.data]);

  const byState = useMemo(() => {
    const all = items.data ?? [];
    return {
      drafts: all.filter((i) => i.state === "draft"),
      approved: all.filter((i) => i.state === "approved"),
      history: all.filter(
        (i) => i.state === "sent" || i.state === "discarded",
      ),
    };
  }, [items.data]);

  function surface(r: GateOutcome, verb: string) {
    if (r.ok) {
      setGateError(null);
      if (verb === "Send") {
        const parts = [
          r.sendMode ? `mode=${r.sendMode}` : null,
          r.externalId ? `id=${r.externalId}` : null,
        ].filter(Boolean);
        setSendNote(parts.length ? `Sent · ${parts.join(" · ")}` : "Sent");
      }
      return;
    }
    const blocks = (r.blockedBy ?? [])
      .map((b) => `${b.gate}: ${b.reason}`)
      .join(" · ");
    setGateError(
      `${verb} refused by gate (${r.code ?? "GATE_BLOCKED"})${
        blocks ? ` — ${blocks}` : ""
      }`,
    );
  }

  async function run(
    id: string,
    verb: string,
    fn: () => Promise<GateOutcome>,
  ) {
    setBusyId(id);
    try {
      surface(await fn(), verb);
    } catch {
      // thrown tRPC errors already surfaced via onError
    } finally {
      setBusyId(null);
    }
  }

  const renderItem = (
    item: NonNullable<typeof items.data>[number],
    actions: React.ReactNode,
  ) => (
    <article key={item.id} className="crm-approval-mini">
      <div className="flex items-center justify-between gap-2">
        <CrmTag kind={item.channel === "gmail" ? "ochre" : "info"}>
          {item.channel} · {item.state}
        </CrmTag>
        <span className="text-[10px] text-[var(--muted)]">
          {companyByDeal.get(item.dealId) ?? "Deal"} → {item.recipient || "—"}
        </span>
      </div>
      <h4>{item.subject ?? "(no subject)"}</h4>
      <p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>
      <div className="crm-approval-actions">{actions}</div>
    </article>
  );

  return (
    <main>
      <CrmPageHeader
        title="Outreach drafts"
        description="AI proposes; the gate disposes. Every send needs a prior human approval — no unattended auto-send."
      />

      {gateError ? (
        <div className="crm-note" role="alert">
          <CrmTag kind="danger">Blocked</CrmTag> {gateError}
        </div>
      ) : null}
      {sendNote ? (
        <div className="crm-note" role="status">
          <CrmTag kind="success">Send</CrmTag> {sendNote}
        </div>
      ) : null}

      <section className="crm-split mt-4">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>Awaiting approval</h3>
              <p>Draft → approved is a gated transition</p>
            </div>
            <CrmTag kind="warn">{byState.drafts.length} pending</CrmTag>
          </div>
          <div className="crm-panel-body crm-approval-stack">
            {items.isLoading ? (
              <CrmEmpty title="Loading drafts…" />
            ) : items.error ? (
              <CrmEmpty
                title="Could not load outreach"
                hint={items.error.message}
              />
            ) : byState.drafts.length === 0 ? (
              <CrmEmpty
                title="Queue empty"
                hint="Draft outreach from a deal to populate this approval list."
              />
            ) : (
              byState.drafts.map((item) =>
                renderItem(
                  item,
                  <>
                    <CrmBtn
                      variant="primary"
                      disabled={busyId !== null}
                      onClick={() =>
                        void run(item.id, "Approve", () =>
                          approve.mutateAsync({ id: item.id }),
                        )
                      }
                    >
                      Approve draft
                    </CrmBtn>
                    <CrmBtn
                      disabled={busyId !== null}
                      onClick={() =>
                        void run(item.id, "Discard", () =>
                          discard.mutateAsync({ id: item.id }),
                        )
                      }
                    >
                      Discard
                    </CrmBtn>
                  </>,
                ),
              )
            )}
          </div>
        </div>

        <aside className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>Approved — ready to send</h3>
              <p>Send executes the Gmail action and marks sent atomically</p>
            </div>
            <CrmTag kind="success">{byState.approved.length} ready</CrmTag>
          </div>
          <div className="crm-panel-body crm-approval-stack">
            {items.isLoading ? (
              <CrmEmpty title="Loading…" />
            ) : byState.approved.length === 0 ? (
              <CrmEmpty
                title="Nothing approved"
                hint="Approve a draft to unlock sending."
              />
            ) : (
              byState.approved.map((item) =>
                renderItem(
                  item,
                  <>
                    <CrmBtn
                      variant="primary"
                      disabled={busyId !== null}
                      onClick={() =>
                        void run(item.id, "Send", () =>
                          send.mutateAsync({ id: item.id }),
                        )
                      }
                    >
                      Send via Gmail
                    </CrmBtn>
                    <CrmBtn
                      disabled={busyId !== null}
                      onClick={() =>
                        void run(item.id, "Discard", () =>
                          discard.mutateAsync({ id: item.id }),
                        )
                      }
                    >
                      Discard
                    </CrmBtn>
                  </>,
                ),
              )
            )}
          </div>
        </aside>
      </section>

      <section className="crm-split mt-4">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>New draft</h3>
              <p>Leave the body empty to let the outreach-draft agent write it</p>
            </div>
          </div>
          <div className="crm-panel-body">
            <form
              className="crm-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draftDealId) return;
                // .mutate (not mutateAsync): refusals — e.g. agent kill switch
                // → PRECONDITION_FAILED — land in onError and render in the
                // gate banner instead of an unhandled rejection.
                draft.mutate({
                  dealId: draftDealId,
                  channel: "gmail",
                  subject: draftSubject.trim() || undefined,
                  body: draftBody.trim() || undefined,
                });
              }}
            >
              <div className="crm-field">
                <label>Deal</label>
                <select
                  className="crm-select"
                  required
                  value={draftDealId}
                  onChange={(e) => setDraftDealId(e.target.value)}
                >
                  <option value="">
                    {deals.isLoading ? "Loading deals…" : "Select a deal"}
                  </option>
                  {(deals.data ?? []).map((d) => (
                    <option key={d.dealId} value={d.dealId}>
                      {d.companyName} · {String(d.stage).replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="crm-field">
                <label>Subject (optional)</label>
                <input
                  className="crm-input"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                />
              </div>
              <div className="crm-field wide">
                <label>Body (optional — AI drafts when empty)</label>
                <textarea
                  className="crm-textarea"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                />
              </div>
              <div className="crm-field wide">
                <CrmBtn
                  variant="primary"
                  type="submit"
                  disabled={!draftDealId || draft.isPending}
                >
                  {draft.isPending ? "Drafting…" : "Create draft"}
                </CrmBtn>
              </div>
            </form>
          </div>
        </div>

        <aside className="crm-panel">
          <div className="crm-panel-head">
            <h3>Channel rules</h3>
          </div>
          <div className="crm-panel-body">
            <div className="crm-checklist">
              <div className="crm-check-row">
                Gmail <span><CrmTag kind="warn">Approval required</CrmTag></span>
              </div>
              <div className="crm-check-row">
                LinkedIn <span><CrmTag kind="info">Copy only</CrmTag></span>
              </div>
              <div className="crm-check-row">
                Auto-send <span><CrmTag kind="danger">Disabled</CrmTag></span>
              </div>
            </div>
            <div className="crm-note">
              LinkedIn has no OAuth automation in V1. Approved copy is manually
              pasted by staff. Sends without a prior approve are refused by the
              outreach gate and audited.
            </div>
          </div>
        </aside>
      </section>

      <div className="mt-4">
        <CrmTableShell foot="Outreach history · gated engine (live)">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Channel</th>
                <th>To</th>
                <th>Subject</th>
                <th>State</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {byState.history.length === 0 ? (
                <tr>
                  <td colSpan={6}>No sent or discarded outreach yet.</td>
                </tr>
              ) : (
                byState.history.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>
                        {companyByDeal.get(item.dealId) ?? "—"}
                      </strong>
                    </td>
                    <td>{item.channel}</td>
                    <td>{item.recipient || "—"}</td>
                    <td>{item.subject ?? "—"}</td>
                    <td>
                      <CrmTag
                        kind={item.state === "sent" ? "success" : "danger"}
                      >
                        {item.state}
                      </CrmTag>
                    </td>
                    <td>{formatRelative(item.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CrmTableShell>
      </div>
    </main>
  );
}
