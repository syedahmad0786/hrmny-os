"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmEmpty, CrmTag } from "@/components/crm/ui";

export function ResearchConsole() {
  const utils = trpc.useUtils();
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
  const runDaily = trpc.salesOs.research.runDaily.useMutation({
    onSuccess: () => void utils.salesOs.invalidate(),
  });
  const decideCompany = trpc.salesOs.research.decide.useMutation({
    onSuccess: () => void utils.salesOs.invalidate(),
  });
  const enrich = trpc.salesOs.research.enrich.useMutation({
    onSuccess: () => void utils.salesOs.invalidate(),
  });
  const decideContact = trpc.salesOs.contacts.decide.useMutation({
    onSuccess: () => void utils.salesOs.invalidate(),
  });
  const draft = trpc.salesOs.contacts.draft.useMutation({
    onSuccess: () => void utils.leadgen.outreach.invalidate(),
  });
  const [feedback, setFeedback] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const companies = [...(researched.data ?? []), ...(rework.data ?? [])];

  return (
    <section className="mt-6" data-testid="sales-os-research-console">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Research gates</h2>
          <p className="text-sm text-[var(--muted)]">
            Today’s sector: {settings.data?.sectorToday ?? "…"}. Gate 1 company
            → free contact discovery → Gate 2 contact → draft. Nothing sends
            itself.
          </p>
        </div>
        <CrmBtn
          variant="primary"
          data-testid="sales-os-run-research"
          disabled={runDaily.isPending}
          onClick={() =>
            runDaily
              .mutateAsync({})
              .then((r) =>
                setNote(
                  `Researched ${r.created.length} · skipped ${r.skipped.length}`,
                ),
              )
          }
        >
          {runDaily.isPending ? "Researching…" : "Run daily research"}
        </CrmBtn>
      </div>
      {note ? (
        <p className="crm-note mb-3" data-testid="sales-os-research-note">
          {note}
        </p>
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
                hint="Run daily research or add a company from Sales OS settings."
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
                  {c.reworkFeedback ? (
                    <p className="text-xs text-[var(--muted)]">
                      Rework: {c.reworkFeedback}
                    </p>
                  ) : null}
                  <div className="crm-approval-actions">
                    <CrmBtn
                      variant="primary"
                      onClick={() =>
                        decideCompany.mutate({ id: c.id, action: "approve" })
                      }
                    >
                      Approve
                    </CrmBtn>
                    <CrmBtn
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
                <CrmBtn
                  variant="primary"
                  disabled={
                    enrich.isPending ||
                    c.temperature === "cool" ||
                    c.temperature === "cold"
                  }
                  onClick={() =>
                    enrich
                      .mutateAsync({ id: c.id })
                      .then((r) =>
                        setNote(
                          `Found ${r.created.length} contacts · ${r.skipped.length} skipped · 0 credits`,
                        ),
                      )
                  }
                >
                  Find contacts · 0 credits
                </CrmBtn>
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
                    }
                  >
                    Approve + draft
                  </CrmBtn>
                  <CrmBtn
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
