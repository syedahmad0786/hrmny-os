"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmEmpty, CrmTag } from "@/components/crm/ui";

function newSignalForm() {
  return {
    requestId: crypto.randomUUID(),
    name: "",
    sector: "",
    whyThis: "",
    website: "",
    evidence: "",
  };
}

export function ResearchConsole() {
  const utils = trpc.useUtils();
  const [feedback, setFeedback] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [signal, setSignal] = useState(newSignalForm);
  const access = trpc.salesOs.access.useQuery();
  const settings = trpc.salesOs.settings.get.useQuery();
  const researched = trpc.salesOs.research.list.useQuery({
    state: "researched",
  });
  const rework = trpc.salesOs.research.list.useQuery({ state: "rework" });
  const approved = trpc.salesOs.research.list.useQuery({ state: "approved" });
  const contactsFound = trpc.salesOs.contacts.list.useQuery({ state: "found" });
  const contactsRework = trpc.salesOs.contacts.list.useQuery({
    state: "rework",
  });
  const contacts = [
    ...(contactsFound.data ?? []),
    ...(contactsRework.data ?? []),
  ];
  const ingest = trpc.salesOs.research.ingest.useMutation({
    onSuccess: () => void utils.salesOs.invalidate(),
  });
  const decideCompany = trpc.salesOs.research.decide.useMutation({
    onSuccess: (_row, variables) => {
      setNote(`Company decision recorded · ${variables.action}`);
      void utils.salesOs.invalidate();
    },
    onError: (error) => setNote(`Company decision failed · ${error.message}`),
  });
  const decideContact = trpc.salesOs.contacts.decide.useMutation({
    onSuccess: () => void utils.salesOs.invalidate(),
    onError: (error) => setNote(`Contact decision failed · ${error.message}`),
  });
  const draft = trpc.salesOs.contacts.draft.useMutation({
    onSuccess: () => void utils.leadgen.outreach.invalidate(),
    onError: (error) => setNote(`Draft creation failed · ${error.message}`),
  });

  const companies = [...(researched.data ?? []), ...(rework.data ?? [])];

  return (
    <section className="mt-6" data-testid="sales-os-research-console">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Research gates</h2>
          <p className="text-sm text-[var(--muted)]">
            Capture a sourced signal → Gate 1 company → free contact discovery →
            Gate 2 contact → draft. Nothing sends itself.
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">
          Review sector: {settings.data?.sectorToday ?? "…"}
        </span>
      </div>
      {note ? (
        <p
          className="crm-note mb-3"
          data-testid="sales-os-research-note"
          role="status"
          aria-live="polite"
        >
          {note}
        </p>
      ) : null}

      {access.error ? (
        <p className="crm-note mb-4" role="alert">
          Sales access could not be verified. All research actions are blocked.
        </p>
      ) : null}

      {access.data && !access.data.canOperate ? (
        <p className="crm-note mb-4" data-testid="sales-os-research-view-only">
          View-only research access. A Sales operator must capture or decide a
          signal.
        </p>
      ) : null}

      {access.data?.canOperate ? (
        <form
          className="crm-panel mb-4"
          data-testid="sales-os-signal-form"
          onSubmit={(event) => {
            event.preventDefault();
            setNote(null);
            ingest
              .mutateAsync({
                requestId: signal.requestId,
                name: signal.name,
                sector: signal.sector || undefined,
                whyThis: signal.whyThis,
                website: signal.website || undefined,
                evidence: signal.evidence,
                leadSourceLane: "staff_signal",
              })
              .then((receipt) => {
                setNote(
                  `Proposal ready for Gate 1 · ${receipt.proposal.name} · receipt ${receipt.receiptId.slice(0, 8)} · no CRM company created`,
                );
                setSignal(newSignalForm());
              })
              .catch((error: unknown) =>
                setNote(
                  error instanceof Error
                    ? error.message
                    : "Signal capture failed",
                ),
              );
          }}
        >
          <div className="crm-panel-head">
            <div>
              <h3>Capture sourced signal</h3>
              <p>
                Saves a review proposal and evidence receipt only. CRM promotion
                happens after approval.
              </p>
            </div>
          </div>
          <div className="crm-panel-body crm-form-grid">
            <label className="crm-field">
              Company
              <input
                className="crm-input"
                data-testid="sales-os-signal-company"
                required
                minLength={2}
                maxLength={180}
                value={signal.name}
                onChange={(event) =>
                  setSignal((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label className="crm-field">
              Sector
              <input
                className="crm-input"
                maxLength={180}
                value={signal.sector}
                onChange={(event) =>
                  setSignal((current) => ({
                    ...current,
                    sector: event.target.value,
                  }))
                }
              />
            </label>
            <label className="crm-field">
              Company website
              <input
                className="crm-input"
                type="url"
                maxLength={500}
                placeholder="https://company.com"
                value={signal.website}
                onChange={(event) =>
                  setSignal((current) => ({
                    ...current,
                    website: event.target.value,
                  }))
                }
              />
            </label>
            <label className="crm-field">
              Source evidence
              <input
                className="crm-input"
                data-testid="sales-os-signal-evidence"
                type="url"
                required
                maxLength={1_000}
                placeholder="https://publisher.com/source"
                value={signal.evidence}
                onChange={(event) =>
                  setSignal((current) => ({
                    ...current,
                    evidence: event.target.value,
                  }))
                }
              />
            </label>
            <label className="crm-field md:col-span-2">
              Why this matters now
              <textarea
                className="crm-textarea"
                data-testid="sales-os-signal-why"
                required
                minLength={8}
                maxLength={2_000}
                value={signal.whyThis}
                onChange={(event) =>
                  setSignal((current) => ({
                    ...current,
                    whyThis: event.target.value,
                  }))
                }
              />
            </label>
            <div>
              <CrmBtn
                type="submit"
                variant="primary"
                data-testid="sales-os-create-proposal"
                disabled={ingest.isPending}
              >
                {ingest.isPending ? "Creating proposal…" : "Create proposal"}
              </CrmBtn>
            </div>
          </div>
        </form>
      ) : null}

      <div className="crm-split">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <h3>Gate 1 — companies</h3>
            <CrmTag kind="warn">{companies.length}</CrmTag>
          </div>
          <div className="crm-panel-body crm-approval-stack">
            {companies.length === 0 ? (
              <CrmEmpty
                title="No researched companies"
                hint="Capture an evidence-bearing signal above."
              />
            ) : (
              companies.map((c) => (
                <article
                  key={c.id}
                  className="crm-approval-mini"
                  data-testid="sales-os-company"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong>{c.name}</strong>
                    <CrmTag kind={c.temperature === "hot" ? "danger" : "info"}>
                      {c.temperature} · {c.buafTotal}
                    </CrmTag>
                  </div>
                  <p className="text-sm">{c.whyThis}</p>
                  {c.evidenceAccepted && c.receiptAccepted && c.evidence ? (
                    <Link
                      className="text-sm underline"
                      href={c.evidence}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View source evidence
                    </Link>
                  ) : (
                    <p className="text-xs text-[var(--danger)]">
                      {!c.evidenceAccepted
                        ? "Evidence missing or placeholder · approval blocked"
                        : "Proposal receipt or signal missing · approval blocked"}
                    </p>
                  )}
                  {c.reworkFeedback ? (
                    <p className="text-xs text-[var(--muted)]">
                      Rework: {c.reworkFeedback}
                    </p>
                  ) : null}
                  <div className="crm-approval-actions">
                    <CrmBtn
                      variant="primary"
                      disabled={
                        !c.evidenceAccepted ||
                        !c.receiptAccepted ||
                        !access.data?.canOperate ||
                        decideCompany.isPending
                      }
                      onClick={() =>
                        decideCompany.mutate({ id: c.id, action: "approve" })
                      }
                    >
                      Approve
                    </CrmBtn>
                    <CrmBtn
                      disabled={
                        !access.data?.canOperate || decideCompany.isPending
                      }
                      onClick={() =>
                        decideCompany.mutate({
                          id: c.id,
                          action: "rework",
                          feedback: feedback || "Tighten the UAE angle",
                        })
                      }
                    >
                      Rework
                    </CrmBtn>
                    <CrmBtn
                      disabled={
                        !access.data?.canOperate || decideCompany.isPending
                      }
                      onClick={() =>
                        decideCompany.mutate({ id: c.id, action: "reject" })
                      }
                    >
                      Reject
                    </CrmBtn>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <aside className="crm-panel">
          <div className="crm-panel-head">
            <h3>Approved — find people</h3>
            <CrmTag kind="success">{(approved.data ?? []).length}</CrmTag>
          </div>
          <div className="crm-panel-body crm-approval-stack">
            {(approved.data ?? []).map((c) => (
              <article key={c.id} className="crm-approval-mini">
                <strong>{c.name}</strong>
                {access.data?.canOperate &&
                c.temperature !== "cool" &&
                c.temperature !== "cold" ? (
                  <Link className="crm-btn primary" href="/crm/hunt#apollo-people-search">
                    Open governed People Search
                  </Link>
                ) : (
                  <span className="text-xs text-[var(--muted)]">
                    Discovery unavailable for this company state
                  </span>
                )}
              </article>
            ))}
          </div>
        </aside>
      </div>

      <div className="crm-panel mt-4">
        <div className="crm-panel-head">
          <h3>Gate 2 — contacts</h3>
          <CrmTag kind="warn">{contacts.length}</CrmTag>
        </div>
        <div className="crm-panel-body">
          <div className="crm-field mb-3">
            <label>Rework feedback</label>
            <input
              className="crm-input"
              disabled={!access.data?.canOperate}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Find someone more senior"
            />
          </div>
          {contacts.length === 0 ? (
            <CrmEmpty
              title="No contacts waiting"
              hint="Approve a company and find contacts."
            />
          ) : (
            contacts.map((c) => (
              <article
                key={c.id}
                className="crm-approval-mini"
                data-testid="sales-os-contact"
              >
                <div className="flex justify-between gap-2">
                  <strong>{c.fullName}</strong>
                  <span className="text-xs text-[var(--muted)]">
                    {c.approvalState} · {c.title} · {c.email ?? "no email"} ·{" "}
                    {c.emailVerdict ?? "—"}
                  </span>
                </div>
                {c.reworkFeedback ? (
                  <p className="text-xs text-[var(--muted)]">
                    Rework: {c.reworkFeedback}
                  </p>
                ) : null}
                <div className="crm-approval-actions">
                  <CrmBtn
                    variant="primary"
                    disabled={
                      !access.data?.canOperate ||
                      decideContact.isPending ||
                      draft.isPending
                    }
                    onClick={() =>
                      decideContact
                        .mutateAsync({ id: c.id, action: "approve" })
                        .then((row) => {
                          if (row.id) return draft.mutateAsync({ id: row.id });
                        })
                        .then(() =>
                          setNote(
                            "Contact approved · multi-channel drafts queued",
                          ),
                        )
                        .catch(() => undefined)
                    }
                  >
                    Approve + draft
                  </CrmBtn>
                  <CrmBtn
                    disabled={
                      !access.data?.canOperate || decideContact.isPending
                    }
                    onClick={() =>
                      decideContact.mutate({
                        id: c.id,
                        action: "rework",
                        feedback: feedback || "More senior",
                      })
                    }
                  >
                    Rework
                  </CrmBtn>
                  <CrmBtn
                    disabled={
                      !access.data?.canOperate || decideContact.isPending
                    }
                    onClick={() =>
                      decideContact.mutate({ id: c.id, action: "reject" })
                    }
                  >
                    Reject
                  </CrmBtn>
                  {c.linkedinUrl ? (
                    <Link
                      className="text-sm underline"
                      href={c.linkedinUrl}
                      target="_blank"
                    >
                      Open LinkedIn
                    </Link>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
