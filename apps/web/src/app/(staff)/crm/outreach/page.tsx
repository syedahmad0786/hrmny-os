"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { orderOutreachWorkItems } from "./order";
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
import { googleWorkspaceGmailApiEnableUrl } from "@/lib/google-workspace-error";

/** Serialized shape of a @hrmny/gate TransitionResult refusal. */
type GateOutcome =
  | {
      ok: true;
      sendMode?: string;
      externalId?: string;
      copyDraft?: boolean;
      providerAccepted?: boolean;
      readbackAt?: string;
      senderEmail?: string;
    }
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
  const followups = trpc.leadgen.outreach.followups.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const mailboxes = trpc.connections.salesMailboxes.useQuery();
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
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draftDealId, setDraftDealId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftChannel, setDraftChannel] = useState("gmail");
  const [reworkFeedback, setReworkFeedback] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showTestRecords, setShowTestRecords] = useState(false);
  const [senderConnectionAccountId, setSenderConnectionAccountId] =
    useState("");

  const invalidate = () => {
    void utils.leadgen.outreach.invalidate();
    void utils.connections.salesMailboxes.invalidate();
    void utils.salesOs.digest.invalidate();
    void utils.salesOs.funnel.invalidate();
  };
  const onErr = (e: { message: string }) => {
    setFeedbackId(null);
    setSendNote(null);
    setGateError(e.message);
  };

  const approve = trpc.leadgen.outreach.approve.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const send = trpc.leadgen.outreach.send.useMutation({
    onSuccess: invalidate,
    onError: onErr,
  });
  const sendTest = trpc.leadgen.outreach.sendTest.useMutation({
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
  const draftFollowup = trpc.leadgen.outreach.draftFollowup.useMutation({
    onSuccess: (item) => {
      setGateError(null);
      setSendNote(
        `Follow-up touch ${item.cadenceTouch} drafted — review it before approval.`,
      );
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
  const availableMailboxes = useMemo(
    () => (mailboxes.data?.items ?? []).filter((mailbox) => mailbox.enabled),
    [mailboxes.data],
  );
  const selectedSender = availableMailboxes.find(
    (mailbox) => mailbox.connectionAccountId === senderConnectionAccountId,
  );
  const senderAccount = selectedSender?.email ?? null;

  useEffect(() => {
    if (
      availableMailboxes.length &&
      !availableMailboxes.some(
        (mailbox) => mailbox.connectionAccountId === senderConnectionAccountId,
      )
    ) {
      setSenderConnectionAccountId(availableMailboxes[0]!.connectionAccountId);
    }
  }, [availableMailboxes, senderConnectionAccountId]);

  const byState = useMemo(() => {
    const all = (items.data ?? []).filter(
      (item) =>
        showTestRecords ||
        item.id === focusId ||
        !hasSyntheticMarker(
          companyByDeal.get(item.dealId),
          item.recipient,
          item.subject,
        ),
    );
    return {
      drafts: orderOutreachWorkItems(
        all.filter((i) => i.state === "draft"),
        focusId,
      ),
      approved: orderOutreachWorkItems(
        all.filter((i) => i.state === "approved"),
        focusId,
      ),
      history: all.filter((i) => i.state === "sent" || i.state === "discarded"),
    };
  }, [items.data, focusId, companyByDeal, showTestRecords]);

  const visibleFollowups = useMemo(
    () =>
      (followups.data ?? []).filter(
        (item) =>
          showTestRecords ||
          !hasSyntheticMarker(companyByDeal.get(item.dealId), item.recipient),
      ),
    [companyByDeal, followups.data, showTestRecords],
  );
  const followupBySource = useMemo(
    () => new Map(visibleFollowups.map((item) => [item.sourceId, item])),
    [visibleFollowups],
  );

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

  useEffect(() => {
    if (!gateError && !sendNote) return;
    document
      .getElementById("outreach-action-feedback")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [gateError, sendNote]);

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
            r.senderEmail || senderAccount
              ? `from ${r.senderEmail ?? senderAccount}`
              : null,
            r.sendMode ? `mode=${r.sendMode}` : null,
            r.externalId ? `id=${r.externalId}` : null,
          ].filter(Boolean);
          setSendNote(
            parts.length
              ? `Gmail accepted and read back · ${parts.join(" · ")}`
              : "Gmail accepted and read back",
          );
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
    setFeedbackId(id);
    setGateError(null);
    setSendNote(null);
    setBusyId(id);
    try {
      surface(await fn(), verb);
    } catch (error) {
      setFeedbackId(id);
      setGateError(error instanceof Error ? error.message : `${verb} failed`);
    } finally {
      setBusyId(null);
    }
  }

  async function prepareFollowup(id: string) {
    setBusyId(id);
    try {
      await draftFollowup.mutateAsync({ id });
    } catch {
      // The mutation surfaces a human-readable reason via onError.
    } finally {
      setBusyId(null);
    }
  }

  async function sendInternalTest(id: string) {
    setFeedbackId(id);
    setGateError(null);
    setSendNote(null);
    setBusyId(id);
    try {
      const result = await sendTest.mutateAsync({
        id,
        idempotencyKey: crypto.randomUUID(),
        senderConnectionAccountId,
      });
      setSendNote(
        `Gmail accepted and read back the internal test to ${result.recipient} · client was not contacted · outreach remains approved.`,
      );
    } catch {
      // The mutation surfaces a human-readable reason via onError.
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
      {!isLinkedIn(item.channel) && item.state === "approved" ? (
        <div
          className="crm-note mt-2 text-[11px]"
          data-testid="outreach-sender-account"
        >
          {senderAccount ? (
            <>
              <label className="crm-field mb-2">
                <span>Send from</span>
                <select
                  className="crm-input"
                  value={senderConnectionAccountId}
                  onChange={(event) =>
                    setSenderConnectionAccountId(event.target.value)
                  }
                >
                  {availableMailboxes.map((mailbox) => (
                    <option
                      key={mailbox.connectionAccountId}
                      value={mailbox.connectionAccountId}
                    >
                      {mailbox.label} · {mailbox.email} ·{" "}
                      {mailbox.remainingToday}/{mailbox.dailyCap} left today
                    </option>
                  ))}
                </select>
              </label>
              <strong>{senderAccount}</strong> will send via Google Workspace
              Gmail. Gmail acceptance is verified by reading the exact message
              back from Sent Mail; delivery is monitored separately.{" "}
              <Link
                href="/settings/connections#conn-google_workspace"
                className="font-bold underline"
              >
                Manage senders
              </Link>
            </>
          ) : mailboxes.isLoading ? (
            "Checking the Gmail sender…"
          ) : (
            <>
              <strong>No Google Workspace sender is ready.</strong>{" "}
              <Link
                href="/settings/connections#conn-google_workspace"
                className="font-bold underline"
              >
                Connect a sender
              </Link>
            </>
          )}
        </div>
      ) : null}
      {feedbackId === item.id && gateError ? (
        <div className="crm-note mt-2" role="alert">
          <CrmTag kind="danger">Not sent</CrmTag> {gateError}
        </div>
      ) : null}
      <div className="crm-approval-actions">{actions}</div>
    </article>
  );

  return (
    <main>
      <CrmPageHeader
        title="Outreach"
        description="Review every draft before anything is sent. Approving a draft and sending it are always two separate decisions."
        actions={
          <Link href="/crm/campaigns" className="crm-btn">
            Campaigns
          </Link>
        }
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
          {showTestRecords ? "Hide" : "Show"} {hiddenTestCount} test draft
          {hiddenTestCount === 1 ? "" : "s"}
        </label>
      ) : null}

      {focusId ? (
        <p className="sr-only" data-testid="outreach-active-id">
          {focusId}
        </p>
      ) : null}

      {gateError ? (
        <div id="outreach-action-feedback" className="crm-note" role="alert">
          <CrmTag kind="danger">Blocked</CrmTag> {gateError}{" "}
          {googleWorkspaceGmailApiEnableUrl(gateError) ? (
            <a
              href={googleWorkspaceGmailApiEnableUrl(gateError)!}
              target="_blank"
              rel="noreferrer"
              className="font-bold underline"
            >
              Enable Gmail API →
            </a>
          ) : null}
        </div>
      ) : null}
      {sendNote ? (
        <div id="outreach-action-feedback" className="crm-note" role="status">
          <CrmTag kind="success">Send</CrmTag> {sendNote}
        </div>
      ) : null}

      <section
        className="crm-panel mt-4"
        data-testid="outreach-cadence-monitor"
      >
        <div className="crm-panel-head">
          <div>
            <h3>Follow-up monitor</h3>
            <p>
              {visibleFollowups.filter((item) => item.state === "due").length}{" "}
              due ·{" "}
              {
                visibleFollowups.filter((item) => item.state === "waiting")
                  .length
              }{" "}
              scheduled ·{" "}
              {
                visibleFollowups.filter((item) => item.state === "queued")
                  .length
              }{" "}
              awaiting review
            </p>
          </div>
          <CrmTag
            kind={
              visibleFollowups.some((item) => item.state === "due")
                ? "warn"
                : "success"
            }
          >
            {visibleFollowups.some((item) => item.state === "due")
              ? "Action due"
              : "Up to date"}
          </CrmTag>
        </div>
        <div className="crm-panel-body text-xs text-[var(--muted)]">
          A reply, unsubscribe, complaint, or bounce stops the cadence. Every
          follow-up is a new draft and still needs review, approval, and a
          separate Gmail send.
        </div>
      </section>

      <section className="crm-split mt-4">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>Awaiting approval</h3>
              <p>Oldest first. Approve, request changes, or discard it.</p>
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
                Oldest first. Email sends only after a second confirmation.
                LinkedIn stays manual.
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
                        data-testid="outreach-send-test"
                        disabled={
                          busyId !== null ||
                          mailboxes.isLoading ||
                          !senderAccount
                        }
                        onClick={() => {
                          const confirmed = window.confirm(
                            `Send an INTERNAL TEST only?\n\nFrom: ${senderAccount ?? "No sender connected"}\nTo: ${senderAccount ?? "No sender connected"}\nOriginal client: ${item.recipient}\n\nThe client will not be contacted and this outreach will stay approved.`,
                          );
                          if (confirmed) void sendInternalTest(item.id);
                        }}
                      >
                        {busyId === item.id
                          ? "Sending test…"
                          : "Send test to myself"}
                      </CrmBtn>
                      <CrmBtn
                        variant="primary"
                        disabled={
                          busyId !== null ||
                          mailboxes.isLoading ||
                          !senderAccount ||
                          (selectedSender?.remainingToday ?? 0) < 1
                        }
                        onClick={() => {
                          const confirmed = window.confirm(
                            `Send this email now?\n\nFrom: ${senderAccount ?? "No sender connected"}\nTo: ${item.recipient}\nSubject: ${item.subject ?? "(no subject)"}\n\nThis creates a real external email.`,
                          );
                          if (!confirmed) return;
                          void run(item.id, "Send", () =>
                            send.mutateAsync({
                              id: item.id,
                              senderConnectionAccountId,
                            }),
                          );
                        }}
                      >
                        {busyId === item.id ? "Sending…" : "Send via Gmail"}
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
                AI first-touch drafts require the lead's saved knowledge brief
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
                {draftDealId && !draftBody.trim() ? (
                  <Link
                    href={`/crm/deals/${draftDealId}#ai-assist`}
                    className="text-[11px] font-bold text-[var(--ochre-dark)]"
                  >
                    Review or build this lead's research first →
                  </Link>
                ) : null}
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
                byState.history.map((item) => {
                  const followup = followupBySource.get(item.id);
                  return (
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
                        {followup ? (
                          <p className="mt-1 text-[10px] text-[var(--muted)]">
                            {followup.reason}
                            {followup.dueAt
                              ? ` · ${new Date(followup.dueAt).toLocaleDateString()}`
                              : ""}
                          </p>
                        ) : null}
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
                        {followup &&
                        (followup.state === "due" ||
                          followup.state === "waiting") ? (
                          <CrmBtn
                            data-testid="outreach-draft-followup"
                            disabled={busyId !== null}
                            onClick={() => void prepareFollowup(item.id)}
                          >
                            {followup.state === "due"
                              ? `Draft touch ${followup.nextTouch}`
                              : `Prepare touch ${followup.nextTouch}`}
                          </CrmBtn>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CrmTableShell>
      </div>
    </main>
  );
}
