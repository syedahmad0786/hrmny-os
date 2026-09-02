"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
  CrmTableShell,
  CrmTag,
} from "@/components/crm/ui";
import { formatRelative } from "@/components/crm/format";
import { HitlReadyBanner } from "@/components/hitl-ready-banner";
import {
  hasSyntheticMarker,
  isSyntheticRecordName,
} from "@/lib/synthetic-records";

/** Serialized shape of a @hrmny/gate TransitionResult refusal. */
type GateOutcome =
  | { ok: true; sendMode?: string; externalId?: string; copyDraft?: boolean }
  | {
      ok: false;
      code?: string;
      blockedBy?: { gate: string; reason: string }[];
    };

export default function CrmOutreachPage() {
  return (
    <Suspense>
      <OutreachInner />
    </Suspense>
  );
}

function OutreachInner() {
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const focusIdFromQuery = searchParams.get("id")?.trim() || "";
  const clientIdFromQuery = searchParams.get("clientId")?.trim() || "";
  const items = trpc.leadgen.outreach.list.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
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
    return (items.data ?? []).find((o) => o.dealId === dealId)?.id ?? null;
  }, [client.data, clientIdFromQuery, focusIdFromQuery, items.data]);
  const focusId = focusIdFromQuery || resolvedClientOutreachId || null;

  const [gateError, setGateError] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftDealId, setDraftDealId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftChannel, setDraftChannel] = useState("gmail");
  const [reworkFeedback, setReworkFeedback] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showTestRecords, setShowTestRecords] = useState(false);

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
  const markSent = trpc.salesOs.linkedin.markSent.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const markAccepted = trpc.salesOs.linkedin.markAccepted.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const markSkipped = trpc.salesOs.linkedin.markSkipped.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const rework = trpc.salesOs.outreach.rework.useMutation({
    onSuccess: () => {
      setReworkFeedback("");
      invalidate();
    },
    onError: onErr,
  });

  function isLinkedIn(channel: string) {
    return channel === "linkedin" || channel.startsWith("linkedin_");
  }

  function linkedInHref(item: NonNullable<typeof items.data>[number]) {
    const raw = item.linkedinUrl ?? item.recipient;
    if (raw.startsWith("http")) return raw;
    return "https://www.linkedin.com/";
  }

  async function copyBody(item: NonNullable<typeof items.data>[number]) {
    try {
      await navigator.clipboard.writeText(item.body);
      setCopiedId(item.id);
      setSendNote("Copied — paste into LinkedIn, then mark sent.");
    } catch {
      setGateError(
        "Clipboard copy failed — select the draft and copy manually.",
      );
    }
  }

  const companyByDeal = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deals.data ?? []) m.set(d.dealId, d.companyName);
    return m;
  }, [deals.data]);

  const byState = useMemo(() => {
    const all = (items.data ?? []).filter(
      (item) =>
        showTestRecords ||
        !hasSyntheticMarker(
          companyByDeal.get(item.dealId),
          item.recipient,
          item.subject,
        ),
    );
    const sortFocus = <T extends { id: string }>(list: T[]) => {
      if (!focusId) return list;
      return [...list].sort((a, b) => {
        if (a.id === focusId) return -1;
        if (b.id === focusId) return 1;
        return 0;
      });
    };
    return {
      drafts: sortFocus(all.filter((i) => i.state === "draft")),
      approved: sortFocus(all.filter((i) => i.state === "approved")),
      history: all.filter((i) => i.state === "sent" || i.state === "discarded"),
    };
  }, [items.data, focusId, companyByDeal, showTestRecords]);

  const hiddenTestCount = (items.data ?? []).filter((item) =>
    hasSyntheticMarker(
      companyByDeal.get(item.dealId),
      item.recipient,
      item.subject,
    ),
  ).length;

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`outreach-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, byState.drafts, byState.approved]);

  function surface(r: GateOutcome, verb: string) {
    if (r.ok) {
      setGateError(null);
      if (verb === "Send") {
        if ("copyDraft" in r && r.copyDraft) {
          setSendNote(
            `Copy draft ready${r.sendMode ? ` · ${r.sendMode}` : ""} — paste manually; still approved`,
          );
        } else {
          const parts = [
            r.sendMode ? `mode=${r.sendMode}` : null,
            r.externalId ? `id=${r.externalId}` : null,
          ].filter(Boolean);
          setSendNote(parts.length ? `Sent · ${parts.join(" · ")}` : "Sent");
        }
      } else if (verb === "Mark sent") {
        setSendNote(
          "Marked sent — LinkedIn assist recorded against the weekly cap.",
        );
      } else if (verb === "Accepted") {
        setSendNote("Connection marked accepted — follow-up can be sent.");
      } else if (verb === "Rework") {
        setSendNote("Returned to draft with feedback.");
      } else if (verb === "Skip") {
        setSendNote("LinkedIn assist skipped.");
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

  async function run(id: string, verb: string, fn: () => Promise<GateOutcome>) {
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
    <article
      key={item.id}
      id={`outreach-${item.id}`}
      data-testid={`outreach-item-${item.id}`}
      data-outreach-state={item.state}
      data-outreach-subject={item.subject ?? ""}
      data-selected={focusId === item.id ? "true" : undefined}
      className={`crm-approval-mini${focusId === item.id ? " is-focused" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <CrmTag kind={isLinkedIn(item.channel) ? "info" : "ochre"}>
          {item.channel} · {item.state}
          {item.cadenceTouch ? ` · touch ${item.cadenceTouch}` : ""}
        </CrmTag>
        <span className="text-[10px] text-[var(--muted)]">
          {companyByDeal.get(item.dealId) ?? "Deal"} → {item.recipient || "—"}
        </span>
      </div>
      <h4 data-testid="outreach-item-subject">
        {item.subject ?? "(no subject)"}
      </h4>
      <p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p>
      {item.reworkFeedback ? (
        <p className="text-xs text-[var(--muted)]">
          Rework: {item.reworkFeedback}
        </p>
      ) : null}
      {item.acceptedAt ? (
        <p className="text-xs text-[var(--muted)]">Connection accepted</p>
      ) : null}
      <div className="crm-approval-actions">{actions}</div>
    </article>
  );

  return (
    <main>
      <CrmPageHeader
        title="Outreach"
        description="Review every draft before anything is sent. Approving a draft and sending it are always two separate decisions."
      />

      <details className="mt-4 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-ink">
          Sending setup
        </summary>
        <div className="mt-3">
          <HitlReadyBanner testIdPrefix="outreach" />
        </div>
      </details>

      {hiddenTestCount ? (
        <label className="mt-3 flex w-fit items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showTestRecords}
            onChange={(event) => setShowTestRecords(event.target.checked)}
          />
          Show {hiddenTestCount} test draft{hiddenTestCount === 1 ? "" : "s"}
        </label>
      ) : null}

      {focusId ? (
        <p className="sr-only" data-testid="outreach-active-id">
          {focusId}
        </p>
      ) : null}

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
              <p>
                Read the message, then approve, request changes, or discard it.
              </p>
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
                      data-testid="outreach-approve"
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
                      disabled={busyId !== null || !reworkFeedback.trim()}
                      data-testid="outreach-rework"
                      onClick={() =>
                        void run(item.id, "Rework", async () => {
                          await rework.mutateAsync({
                            id: item.id,
                            feedback: reworkFeedback.trim(),
                          });
                          return { ok: true };
                        })
                      }
                    >
                      Rework
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
            {byState.drafts.length > 0 ? (
              <div className="crm-field mt-3">
                <label>Rework feedback</label>
                <input
                  className="crm-input"
                  data-testid="outreach-rework-feedback"
                  value={reworkFeedback}
                  onChange={(e) => setReworkFeedback(e.target.value)}
                  placeholder="More specific to this launch"
                />
              </div>
            ) : null}
          </div>
        </div>

        <aside className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>Approved — ready to send</h3>
              <p>
                Email sends only after a second confirmation. LinkedIn stays
                manual.
              </p>
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
                  isLinkedIn(item.channel) ? (
                    <>
                      <CrmBtn
                        variant="primary"
                        data-testid="outreach-copy-linkedin"
                        disabled={busyId !== null}
                        onClick={() => void copyBody(item)}
                      >
                        {copiedId === item.id ? "Copied" : "Copy"}
                      </CrmBtn>
                      <a
                        className="crm-btn"
                        data-testid="outreach-open-linkedin"
                        href={linkedInHref(item)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open LinkedIn
                      </a>
                      <CrmBtn
                        data-testid="outreach-mark-sent"
                        disabled={busyId !== null}
                        onClick={() =>
                          void run(item.id, "Mark sent", async () => {
                            await markSent.mutateAsync({ id: item.id });
                            return { ok: true };
                          })
                        }
                      >
                        Mark sent
                      </CrmBtn>
                      {item.channel === "linkedin_connect" ? (
                        <CrmBtn
                          data-testid="outreach-mark-accepted"
                          disabled={busyId !== null}
                          onClick={() =>
                            void run(item.id, "Accepted", async () => {
                              await markAccepted.mutateAsync({ id: item.id });
                              return { ok: true };
                            })
                          }
                        >
                          Mark accepted
                        </CrmBtn>
                      ) : null}
                      <CrmBtn
                        disabled={busyId !== null}
                        onClick={() =>
                          void run(item.id, "Skip", async () => {
                            await markSkipped.mutateAsync({ id: item.id });
                            return { ok: true };
                          })
                        }
                      >
                        Skip
                      </CrmBtn>
                    </>
                  ) : (
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
                    </>
                  ),
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
              <p>
                Leave the body empty to let the outreach-draft agent write it
              </p>
            </div>
          </div>
          <div className="crm-panel-body">
            <form
              className="crm-form-grid"
              data-testid="outreach-draft-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draftDealId) return;
                // .mutate (not mutateAsync): refusals — e.g. agent kill switch
                // → PRECONDITION_FAILED — land in onError and render in the
                // gate banner instead of an unhandled rejection.
                draft.mutate({
                  dealId: draftDealId,
                  channel: draftChannel,
                  subject: draftSubject.trim() || undefined,
                  body: draftBody.trim() || undefined,
                });
              }}
            >
              <div className="crm-field">
                <label>Deal</label>
                <select
                  className="crm-select"
                  data-testid="outreach-draft-deal"
                  required
                  value={draftDealId}
                  onChange={(e) => setDraftDealId(e.target.value)}
                >
                  <option value="">
                    {deals.isLoading ? "Loading deals…" : "Select a deal"}
                  </option>
                  {(deals.data ?? [])
                    .filter(
                      (deal) =>
                        showTestRecords ||
                        !isSyntheticRecordName(deal.companyName),
                    )
                    .map((d) => (
                      <option key={d.dealId} value={d.dealId}>
                        {d.companyName} · {String(d.stage).replace(/_/g, " ")}
                      </option>
                    ))}
                </select>
              </div>
              <div className="crm-field">
                <label>Channel</label>
                <select
                  className="crm-select"
                  data-testid="outreach-draft-channel"
                  value={draftChannel}
                  onChange={(e) => setDraftChannel(e.target.value)}
                >
                  <option value="gmail">Email (Gmail HITL)</option>
                  <option value="linkedin_connect">
                    LinkedIn connect (copy)
                  </option>
                  <option value="linkedin_followup">
                    LinkedIn follow-up (copy)
                  </option>
                </select>
              </div>
              <div className="crm-field">
                <label>Subject (optional)</label>
                <input
                  className="crm-input"
                  data-testid="outreach-draft-subject"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                />
              </div>
              <div className="crm-field wide">
                <label>Body (optional — AI drafts when empty)</label>
                <textarea
                  className="crm-textarea"
                  data-testid="outreach-draft-body"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                />
              </div>
              <div className="crm-field wide">
                <CrmBtn
                  variant="primary"
                  type="submit"
                  data-testid="outreach-draft-create"
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
            <h3>Before anything is sent</h3>
          </div>
          <div className="crm-panel-body">
            <div className="crm-checklist">
              <div className="crm-check-row">
                Gmail{" "}
                <span>
                  <CrmTag kind="warn">Approval required</CrmTag>
                </span>
              </div>
              <div className="crm-check-row">
                LinkedIn{" "}
                <span>
                  <CrmTag kind="info">Copy + mark sent</CrmTag>
                </span>
              </div>
              <div className="crm-check-row">
                Auto-send{" "}
                <span>
                  <CrmTag kind="danger">Disabled</CrmTag>
                </span>
              </div>
              <div className="crm-check-row">
                Tracking pixels{" "}
                <span>
                  <CrmTag kind="danger">Off</CrmTag>
                </span>
              </div>
            </div>
            <div className="crm-note">
              LinkedIn is never automated. Copy the draft, send in LinkedIn,
              then mark sent / accepted. Follow-up stays locked until the
              connect is marked Accepted. Email send checks suppression, daily
              cap, and the identity footer first.
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
                <th />
              </tr>
            </thead>
            <tbody>
              {byState.history.length === 0 ? (
                <tr>
                  <td colSpan={7}>No sent or discarded outreach yet.</td>
                </tr>
              ) : (
                byState.history.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{companyByDeal.get(item.dealId) ?? "—"}</strong>
                    </td>
                    <td>{item.channel}</td>
                    <td>{item.recipient || "—"}</td>
                    <td>{item.subject ?? "—"}</td>
                    <td>
                      <CrmTag
                        kind={item.state === "sent" ? "success" : "danger"}
                      >
                        {item.state}
                        {item.acceptedAt ? " · accepted" : ""}
                      </CrmTag>
                    </td>
                    <td>{formatRelative(item.updatedAt)}</td>
                    <td>
                      {item.channel === "linkedin_connect" &&
                      item.state === "sent" &&
                      !item.acceptedAt ? (
                        <CrmBtn
                          data-testid="outreach-mark-accepted-history"
                          disabled={busyId !== null}
                          onClick={() =>
                            void run(item.id, "Accepted", async () => {
                              await markAccepted.mutateAsync({ id: item.id });
                              return { ok: true };
                            })
                          }
                        >
                          Mark accepted
                        </CrmBtn>
                      ) : null}
                    </td>
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
