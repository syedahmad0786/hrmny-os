"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmPageHeader } from "@/components/crm/ui";

export default function CompanyIntelligencePage() {
  const utils = trpc.useUtils();
  const companies = trpc.crm.companies.list.useQuery();
  const [companyId, setCompanyId] = useState("");
  const [query, setQuery] = useState("");
  const [goal, setGoal] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const history = trpc.salesOs.workspace.history.useQuery({
    search: archiveSearch,
  });
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const context = trpc.salesOs.workspace.company.useQuery(
    { companyId },
    { enabled: !!companyId },
  );
  const briefs = trpc.salesOs.workspace.briefs.useQuery();
  const prepare = trpc.salesOs.workspace.prepareMeeting.useMutation({
    onSuccess: () => {
      setNote("Your private brief is ready below.");
      setRequestId(crypto.randomUUID());
      void utils.salesOs.workspace.briefs.invalidate();
    },
    onError: (error) => {
      setNote(error.message);
      void utils.salesOs.workspace.briefs.invalidate();
    },
  });
  const selected = context.data;
  return (
    <>
      <CrmPageHeader
        title="Company intelligence"
        description="Relationship history, proposals, people and a private meeting brief in one place."
      />
      <section className="crm-panel mt-5">
        <div className="crm-panel-body space-y-4">
          <div className="crm-form-grid">
            <label className="crm-field">
              Find a company
              <input
                className="crm-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search company names"
              />
            </label>
            <label className="crm-field">
              Company
              <select
                className="crm-select"
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value);
                  setRequestId(crypto.randomUUID());
                }}
              >
                <option value="">Select a company</option>
                {companies.data
                  ?.filter(
                    (row) =>
                      row.name.toLowerCase().includes(query.toLowerCase()) ||
                      row.companyId === companyId,
                  )
                  .map((row) => (
                    <option key={row.companyId} value={row.companyId}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {companies.error || context.error ? (
            <p role="alert">
              {companies.error?.message ?? context.error?.message}
            </p>
          ) : null}
          {!companyId ? (
            <p>
              Select an existing company, or{" "}
              <Link className="underline" href="/crm/research">
                research a new opportunity
              </Link>
              .
            </p>
          ) : null}
          {selected ? (
            <>
              <h2 className="text-xl font-semibold">{selected.company.name}</h2>
              <p>
                {selected.company.notes || "No company overview saved yet."}
              </p>
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="font-semibold">People & roles</h3>
                  {selected.contacts.map((row) => (
                    <p key={row.contactId} className="my-2">
                      {row.firstName} {row.lastName} ·{" "}
                      {row.title ?? "Role needs verification"}
                    </p>
                  ))}
                  {!selected.contacts.length ? (
                    <p>No contacts linked.</p>
                  ) : null}
                </div>
                <div>
                  <h3 className="font-semibold">Opportunities & outcomes</h3>
                  {selected.deals.map((row) => (
                    <p key={row.dealId} className="my-2">
                      <Link
                        className="underline"
                        href={`/crm/deals/${row.dealId}`}
                      >
                        {row.companyName}
                      </Link>{" "}
                      · {row.closeOutcome ?? row.stage}
                      {row.lostReason ? ` · ${row.lostReason}` : ""}
                    </p>
                  ))}
                </div>
              </div>
              <details>
                <summary className="cursor-pointer font-semibold">
                  Relationship and proposal history
                </summary>
                {selected.activities.map((row) => (
                  <article
                    key={row.activityId}
                    className="mt-3 border-t border-[var(--line)] pt-3"
                  >
                    <h4>
                      {row.subject ?? row.type} ·{" "}
                      {new Date(row.occurredAt).toLocaleDateString()}
                    </h4>
                    <p className="whitespace-pre-wrap text-sm">{row.body}</p>
                  </article>
                ))}
                {!selected.activities.length ? (
                  <p>No imported history or recorded activities.</p>
                ) : null}
                {selected.notes.map((row) => (
                  <p
                    className="mt-3 whitespace-pre-wrap text-sm"
                    key={row.crmNoteId}
                  >
                    {row.body}
                  </p>
                ))}
              </details>
              <h3 className="font-semibold">Prepare for the conversation</h3>
              <label className="crm-field">
                Meeting goal
                <textarea
                  className="crm-textarea"
                  value={goal}
                  maxLength={1000}
                  onChange={(event) => {
                    setGoal(event.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                  placeholder="Who are you meeting and what outcome do you want?"
                />
              </label>
              <p className="text-sm text-[var(--muted)]">
                Uses CRM history and your connected Gmail, Drive and Calendar.
                Briefs stay private to you. Missing sources and conflicting
                evidence are called out. AI usage limits apply.
              </p>
              <CrmBtn
                variant="primary"
                disabled={prepare.isPending}
                onClick={() => prepare.mutate({ companyId, requestId, goal })}
              >
                {prepare.isPending ? "Preparing…" : "Prepare private brief"}
              </CrmBtn>
              {prepare.isError ? (
                <CrmBtn
                  onClick={() => {
                    setRequestId(crypto.randomUUID());
                    setNote(
                      "New request prepared. Check history before running again.",
                    );
                  }}
                >
                  Prepare a new request
                </CrmBtn>
              ) : null}
              <Link className="crm-btn ml-2" href="/crm/tasks">
                Track next action
              </Link>
            </>
          ) : null}
          {note ? (
            <p role="status" className="crm-note">
              {note}
            </p>
          ) : null}
        </div>
      </section>
      <section className="crm-panel mt-5">
        <div className="crm-panel-head">
          <h2>Search relationship history</h2>
        </div>
        <div className="crm-panel-body space-y-3">
          <p className="text-sm">
            Shared CRM activity and private archive records you are authorized
            to read. Legacy dates are historical; they do not update the current
            forecast.
          </p>
          <label className="crm-field">
            Search notes, communications and proposals
            <input
              className="crm-input"
              value={archiveSearch}
              maxLength={180}
              onChange={(event) => setArchiveSearch(event.target.value)}
              placeholder="Company, contact, proposal or topic"
            />
          </label>
          {history.error ? <p role="alert">{history.error.message}</p> : null}
          {history.data?.map((row) => (
            <details key={row.activityId}>
              <summary className="cursor-pointer">
                {row.subject ?? row.type}
                {row.metadata.visibility === "private"
                  ? " · Restricted archive"
                  : ""}
              </summary>
              <p className="whitespace-pre-wrap text-sm">{row.body}</p>
              <p className="text-xs">
                Source: {String(row.metadata.source ?? "CRM")} ·{" "}
                {String(
                  row.metadata.historicalYear ??
                    new Date(row.occurredAt).toLocaleDateString(),
                )}
              </p>
            </details>
          ))}
          {history.data?.length === 0 ? (
            <p>No matching history you can access.</p>
          ) : null}
        </div>
      </section>
      <section className="crm-panel mt-5">
        <div className="crm-panel-head">
          <h2>Your private meeting briefs</h2>
        </div>
        <div className="crm-panel-body space-y-4">
          {briefs.error ? <p role="alert">{briefs.error.message}</p> : null}
          {briefs.data
            ?.filter(
              (row) =>
                !companyId ||
                row.result?.companyId === companyId ||
                !row.result,
            )
            .map((row) => (
              <details key={row.id} open={row.id === briefs.data?.[0]?.id}>
                <summary className="cursor-pointer">
                  {String(row.result?.companyName ?? "Meeting preparation")} ·{" "}
                  {row.status}
                </summary>
                {row.error ? <p role="alert">{row.error}</p> : null}
                {row.result ? (
                  <>
                    <p className="my-2 text-sm">
                      Only you · {String(row.result.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {String(row.result.brief)}
                    </p>
                    <p className="mt-3 text-sm">
                      Source coverage: {JSON.stringify(row.result.coverage)}
                    </p>
                    <CrmBtn
                      className="mt-3"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(String(row.result?.brief))
                          .then(() => setNote("Brief copied."))
                          .catch(() =>
                            setNote(
                              "Copy failed. Select the brief text and copy it manually.",
                            ),
                          )
                      }
                    >
                      Copy brief
                    </CrmBtn>
                  </>
                ) : (
                  <p>No completed brief yet. Refresh to check its status.</p>
                )}
              </details>
            ))}
          {!briefs.data?.length ? <p>No private meeting briefs yet.</p> : null}
        </div>
      </section>
    </>
  );
}
