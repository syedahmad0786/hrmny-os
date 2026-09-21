"use client";

import { useState } from "react";
import { CrmBtn, CrmEmpty, CrmTag } from "@/components/crm/ui";
import { CRM_MARKETS } from "@/lib/crm-markets";
import { trpc } from "@/lib/trpc";

const queues = [
  ["needs_review", "Needs review"],
  ["needs_evidence", "Needs evidence"],
  ["parked", "Parked"],
  ["accepted", "Accepted"],
  ["rejected", "Rejected"],
] as const;

function newSubmission() {
  return {
    requestId: crypto.randomUUID(),
    companyName: "",
    website: "",
    market: "UAE" as (typeof CRM_MARKETS)[number],
    whyNow: "",
    relevantService: "",
    sourceUrl: "",
    excerpt: "",
    eventDate: "",
    visibilityScope: "public" as "public" | "restricted" | "private",
  };
}

export function DiscoveryReview() {
  const utils = trpc.useUtils();
  const access = trpc.salesOs.access.useQuery();
  const summary = trpc.salesOs.discovery.review.summary.useQuery();
  const [queue, setQueue] =
    useState<(typeof queues)[number][0]>("needs_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(newSubmission);
  const [reason, setReason] = useState("");
  const [linkCompanyId, setLinkCompanyId] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const candidates = trpc.salesOs.discovery.review.list.useQuery({ queue });
  const selected = trpc.salesOs.discovery.review.get.useQuery(
    { candidateId: selectedId ?? "" },
    { enabled: Boolean(selectedId) },
  );
  const companies = trpc.crm.companies.list.useQuery(
    { search: selected.data?.companyName },
    { enabled: Boolean(selected.data?.companyName) },
  );
  const submit = trpc.salesOs.discovery.review.submit.useMutation({
    onSuccess: (candidate) => {
      setSelectedId(candidate.id);
      setForm(newSubmission());
      setNote(
        `Saved ${candidate.reviewState.replaceAll("_", " ")}. Collectors stay off.`,
      );
      void utils.salesOs.discovery.review.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const decide = trpc.salesOs.discovery.review.decide.useMutation({
    onSuccess: (candidate) => {
      setSelectedId(candidate.id);
      setReason("");
      setNote(
        candidate.reviewState === "accepted"
          ? `Accepted and linked to one company. No contact or deal was created.`
          : `Recorded ${candidate.reviewState.replaceAll("_", " ")}.`,
      );
      void utils.salesOs.discovery.review.invalidate();
      void utils.crm.companies.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const canOperate = access.data?.canOperate === true;
  const detail = selected.data;

  return (
    <section className="crm-panel mb-5" data-testid="discovery-review">
      <div className="crm-panel-head">
        <div>
          <h3>Discovery review</h3>
          <p>
            Counts come from the same records as the queues. Acceptance links
            or creates exactly one company. It does not create a contact, deal
            or outreach.
          </p>
        </div>
      </div>
      <div className="crm-panel-body space-y-4">
        <p className="crm-note" data-testid="discovery-review-status">
          <strong>
            {summary.data?.executionEnabled
              ? "Candidate store includes collector results."
              : "Candidate store: operator submissions only."}
          </strong>{" "}
          {summary.data?.executionEnabled
            ? "Collectors can write Review candidates. This is not accepted Discovery coverage until remaining sources, schedules and recovery are proved."
            : "Collectors stay off. This is not accepted Discovery coverage."}
        </p>
        {summary.error ? <p role="alert">{summary.error.message}</p> : null}
        {summary.data ? (
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="discovery-review-counts"
          >
            <article className="crm-approval-mini">
              <strong>Needs review</strong>
              <p data-testid="discovery-review-needs-review">
                {summary.data.needsReview}
              </p>
              <CrmTag kind={summary.data.needsReview ? "warn" : "info"}>
                {summary.data.needsReview ? "Ready to decide" : "Queue empty"}
              </CrmTag>
            </article>
            <article className="crm-approval-mini">
              <strong>Needs evidence</strong>
              <p data-testid="discovery-review-needs-evidence">
                {summary.data.needsEvidence}
              </p>
              <CrmTag kind={summary.data.needsEvidence ? "warn" : "info"}>
                {summary.data.needsEvidence
                  ? "Date or source missing"
                  : "Queue empty"}
              </CrmTag>
            </article>
            <article className="crm-approval-mini">
              <strong>Research running</strong>
              <p data-testid="discovery-review-research-running">
                {summary.data.researchRunning}
              </p>
              <CrmTag kind={summary.data.researchRunning ? "warn" : "info"}>
                {summary.data.researchRunning
                  ? "Cancel requested or in flight"
                  : "No collector in flight"}
              </CrmTag>
            </article>
            <article className="crm-approval-mini">
              <strong>Sources needing attention</strong>
              <p data-testid="discovery-review-sources-attention">
                {summary.data.sourcesNeedingAttention}
              </p>
              <CrmTag
                kind={
                  summary.data.sourcesNeedingAttention ? "warn" : "success"
                }
              >
                {summary.data.sourcesNeedingAttention
                  ? "Blocked required sources"
                  : "No programme blockers"}
              </CrmTag>
            </article>
          </div>
        ) : (
          <CrmEmpty title="Loading Discovery review counts" />
        )}

        {canOperate ? (
          <form
            className="space-y-3"
            data-testid="discovery-candidate-submit"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate({
                requestId: form.requestId,
                companyName: form.companyName,
                ...(form.website ? { website: form.website } : {}),
                market: form.market,
                whyNow: form.whyNow,
                ...(form.relevantService
                  ? { relevantService: form.relevantService }
                  : {}),
                sourceUrl: form.sourceUrl,
                excerpt: form.excerpt,
                ...(form.eventDate ? { eventDate: form.eventDate } : {}),
                visibilityScope: form.visibilityScope,
              });
            }}
          >
            <h4>Submit operator evidence</h4>
            <p className="text-sm text-[var(--muted)]">
              Use a public HTTPS source. Private excerpts stay hidden from
              people who do not own or review the candidate.
            </p>
            <label>
              Company
              <input
                data-testid="discovery-candidate-name"
                value={form.companyName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    companyName: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              Website
              <input
                data-testid="discovery-candidate-website"
                value={form.website}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    website: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Why now
              <textarea
                data-testid="discovery-candidate-why"
                value={form.whyNow}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    whyNow: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              Source URL
              <input
                data-testid="discovery-candidate-source-url"
                value={form.sourceUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sourceUrl: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              Supporting excerpt
              <textarea
                data-testid="discovery-candidate-excerpt"
                value={form.excerpt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    excerpt: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              Event date
              <input
                data-testid="discovery-candidate-event-date"
                type="date"
                value={form.eventDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    eventDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Evidence visibility
              <select
                data-testid="discovery-candidate-visibility"
                value={form.visibilityScope}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    visibilityScope: event.target
                      .value as typeof form.visibilityScope,
                  }))
                }
              >
                <option value="public">Public</option>
                <option value="restricted">Restricted</option>
                <option value="private">Private</option>
              </select>
            </label>
            <CrmBtn
              type="submit"
              data-testid="discovery-candidate-save"
              disabled={submit.isPending}
            >
              Save for review
            </CrmBtn>
          </form>
        ) : null}

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Review queues">
          {queues.map(([id, label]) => (
            <CrmBtn
              key={id}
              variant={queue === id ? "primary" : "default"}
              data-testid={`discovery-review-queue-${id}`}
              onClick={() => setQueue(id)}
            >
              {label}
            </CrmBtn>
          ))}
        </div>

        {note ? (
          <p className="crm-note" data-testid="discovery-review-note" role="status">
            {note}
          </p>
        ) : null}

        {candidates.data?.length ? (
          <ul className="space-y-2" data-testid="discovery-candidate-list">
            {candidates.data.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="crm-approval-mini w-full text-left"
                  data-testid={`discovery-candidate-${candidate.id}`}
                  onClick={() => setSelectedId(candidate.id)}
                >
                  <strong>{candidate.companyName}</strong>
                  <p>
                    {candidate.opportunityKind.replaceAll("_", " ")} ·{" "}
                    {candidate.reviewState.replaceAll("_", " ")}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <CrmEmpty
            title="No Discovery candidates in this queue"
            hint="Submit operator evidence above, or wait for a later collector. Manual CRM research below does not start collectors."
          />
        )}

        {detail ? (
          <article
            className="space-y-3"
            data-testid="discovery-candidate-detail"
          >
            <h4>{detail.companyName}</h4>
            <p data-testid="discovery-candidate-state">
              {detail.reviewState.replaceAll("_", " ")} · qualification not
              assessed
            </p>
            <p>{detail.whyNow}</p>
            {detail.companyId ? (
              <p data-testid="discovery-candidate-company">
                Linked company {detail.companyId}
              </p>
            ) : null}
            <div data-testid="discovery-candidate-evidence">
              {(detail.evidence ?? []).map((item) => (
                <div key={item.id}>
                  <p>
                    {item.eventDate ?? "No event date"} · {item.visibilityScope}
                  </p>
                  {item.excerptHidden ? (
                    <p data-testid="discovery-candidate-excerpt-hidden">
                      Excerpt hidden
                    </p>
                  ) : (
                    <p data-testid="discovery-candidate-excerpt-text">
                      {item.excerpt}
                    </p>
                  )}
                  {item.sourceUrl ? <p>{item.sourceUrl}</p> : null}
                </div>
              ))}
            </div>
            {detail.evaluation ? (
              <div
                className="space-y-2"
                data-testid="discovery-candidate-evaluation"
              >
                <p data-testid="discovery-candidate-disposition">
                  Disposition {detail.evaluation.disposition.replaceAll("_", " ")}
                </p>
                <div data-testid="discovery-candidate-facts">
                  <strong>Facts</strong>
                  {detail.evaluation.facts.map((fact) => (
                    <p key={fact.id}>{fact.text}</p>
                  ))}
                </div>
                <div data-testid="discovery-candidate-interpretations">
                  <strong>AI interpretation</strong>
                  {detail.evaluation.interpretations.length ? (
                    detail.evaluation.interpretations.map((claim) => (
                      <p key={claim.id}>
                        {claim.text}
                        {claim.grounded ? "" : " (ungrounded)"}
                      </p>
                    ))
                  ) : (
                    <p>
                      No AI interpretation. Deterministic rules classified this
                      evidence.
                    </p>
                  )}
                </div>
                {detail.evaluation.reasons.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : null}
            {canOperate && detail.reviewState !== "rejected" ? (
              <div className="space-y-2">
                <label>
                  Decision reason
                  <textarea
                    data-testid="discovery-candidate-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <CrmBtn
                    data-testid="discovery-candidate-accept"
                    disabled={
                      decide.isPending ||
                      (detail.reviewState !== "needs_review" &&
                        detail.reviewState !== "corrected" &&
                        detail.reviewState !== "parked" &&
                        detail.reviewState !== "accepted")
                    }
                    onClick={() =>
                      decide.mutate({
                        action: "accept",
                        candidateId: detail.id,
                        expectedVersion: detail.expectedVersion,
                        ...(reason ? { reason } : {}),
                      })
                    }
                  >
                    Accept for qualification
                  </CrmBtn>
                  <CrmBtn
                    data-testid="discovery-candidate-correct"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        action: "correct",
                        candidateId: detail.id,
                        expectedVersion: detail.expectedVersion,
                        reason: reason || "Corrected company facts before review",
                      })
                    }
                  >
                    Correct
                  </CrmBtn>
                  <CrmBtn
                    data-testid="discovery-candidate-request-evidence"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        action: "request_evidence",
                        candidateId: detail.id,
                        expectedVersion: detail.expectedVersion,
                        reason:
                          reason || "Need a dated source before acceptance",
                      })
                    }
                  >
                    Request more evidence
                  </CrmBtn>
                  <CrmBtn
                    data-testid="discovery-candidate-park"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        action: "park",
                        candidateId: detail.id,
                        expectedVersion: detail.expectedVersion,
                        reason: reason || "Parked pending a later decision",
                      })
                    }
                  >
                    Park
                  </CrmBtn>
                  <CrmBtn
                    data-testid="discovery-candidate-reject"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        action: "reject",
                        candidateId: detail.id,
                        expectedVersion: detail.expectedVersion,
                        reason: reason || "Rejected as not a Discovery fit",
                      })
                    }
                  >
                    Reject
                  </CrmBtn>
                </div>
                <label>
                  Link existing company
                  <select
                    data-testid="discovery-candidate-link-select"
                    value={linkCompanyId}
                    onChange={(event) => setLinkCompanyId(event.target.value)}
                  >
                    <option value="">Select a company</option>
                    {(detail.matchingCompanies.length
                      ? detail.matchingCompanies
                      : (companies.data ?? []).map((company) => ({
                          companyId: company.companyId,
                          name: company.name,
                        }))
                    ).map((company) => (
                      <option key={company.companyId} value={company.companyId}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </label>
                <CrmBtn
                  data-testid="discovery-candidate-link"
                  disabled={decide.isPending || !linkCompanyId}
                  onClick={() =>
                    decide.mutate({
                      action: "link",
                      candidateId: detail.id,
                      expectedVersion: detail.expectedVersion,
                      companyId: linkCompanyId,
                      ...(reason ? { reason } : {}),
                    })
                  }
                >
                  Link existing company
                </CrmBtn>
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}
