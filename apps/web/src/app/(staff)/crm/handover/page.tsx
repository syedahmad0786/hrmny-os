"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatAed, formatContactName } from "@/components/crm/format";
import {
  CrmBtn,
  CrmEmpty,
  CrmFilterBar,
  CrmPageHeader,
  CrmTag,
} from "@/components/crm/ui";
import { trpc } from "@/lib/trpc";

const BRAND_PREFIX = "HANDOVER:BRAND_ASSETS —";
const BILLING_PREFIX = "HANDOVER:BILLING_DETAILS —";

export default function CrmHandoverPage() {
  const utils = trpc.useUtils();
  const deals = trpc.crm.deals.list.useQuery();
  const [dealId, setDealId] = useState("");
  const [brandAssets, setBrandAssets] = useState("");
  const [billingDetails, setBillingDetails] = useState("");
  const [status, setStatus] = useState("");

  const candidates = useMemo(
    () =>
      (deals.data ?? []).filter(
        (deal) => deal.stage === "close" || deal.stage === "handover_pack",
      ),
    [deals.data],
  );

  useEffect(() => {
    if (dealId || candidates.length === 0) return;
    const requested = new URLSearchParams(window.location.search).get("dealId");
    setDealId(
      candidates.some((deal) => deal.dealId === requested)
        ? requested!
        : candidates[0]!.dealId,
    );
  }, [candidates, dealId]);

  const deal = candidates.find((candidate) => candidate.dealId === dealId);
  const contact = trpc.crm.contacts.get.useQuery(
    { id: deal?.primaryContactId ?? "" },
    { enabled: Boolean(deal?.primaryContactId) },
  );
  const quotes = trpc.crm.quotes.listByDeal.useQuery(
    { dealId: deal?.dealId ?? "" },
    { enabled: Boolean(deal) },
  );
  const tasks = trpc.crm.tasks.list.useQuery(
    { dealId: deal?.dealId ?? "" },
    { enabled: Boolean(deal) },
  );
  const notes = trpc.crm.notes.list.useQuery(
    { dealId: deal?.dealId ?? "" },
    { enabled: Boolean(deal) },
  );
  const addNote = trpc.crm.notes.create.useMutation({
    onSuccess: () => void utils.crm.notes.invalidate(),
  });

  const latestQuote = quotes.data?.[0];
  const keyDate = (tasks.data ?? []).find(
    (task) =>
      task.status !== "done" && task.status !== "cancelled" && task.dueDate,
  );
  const brandEvidence = (notes.data ?? []).find((note) =>
    note.body.startsWith(BRAND_PREFIX),
  );
  const billingEvidence = (notes.data ?? []).find((note) =>
    note.body.startsWith(BILLING_PREFIX),
  );
  const checks = [
    {
      key: "signed-scope",
      label: "Signed scope",
      ready: latestQuote?.status === "accepted",
      detail:
        latestQuote?.status === "accepted"
          ? `Quote v${latestQuote.version} accepted`
          : "Accept the latest quote with signed evidence",
    },
    {
      key: "agreed-price",
      label: "Agreed price",
      ready: Number(latestQuote?.quoteValue ?? 0) > 0,
      detail:
        Number(latestQuote?.quoteValue ?? 0) > 0
          ? formatAed(latestQuote?.quoteValue)
          : "Add a priced quote",
    },
    {
      key: "client-contact",
      label: "Client contact",
      ready: Boolean(contact.data),
      detail: formatContactName(contact.data) ?? "Choose a primary contact",
    },
    {
      key: "key-date",
      label: "Key date",
      ready: Boolean(keyDate?.dueDate),
      detail: keyDate?.dueDate
        ? `${keyDate.title} · ${keyDate.dueDate.slice(0, 10)}`
        : "Add an open deal task with a due date",
    },
    {
      key: "brand-assets",
      label: "Brand assets",
      ready: Boolean(brandEvidence),
      detail:
        brandEvidence?.body.slice(BRAND_PREFIX.length).trim() ||
        "Record where Delivery can find them",
    },
    {
      key: "billing-details",
      label: "Billing details",
      ready: Boolean(billingEvidence),
      detail:
        billingEvidence?.body.slice(BILLING_PREFIX.length).trim() ||
        "Record the billing contact or TRN status",
    },
  ];
  const readyCount = checks.filter((check) => check.ready).length;
  const ready = readyCount === checks.length;

  const saveEvidence = async (
    prefix: string,
    value: string,
    clear: () => void,
    label: string,
  ) => {
    if (!deal || !value.trim()) return;
    await addNote.mutateAsync({
      dealId: deal.dealId,
      body: `${prefix} ${value.trim()}`,
    });
    clear();
    setStatus(`${label} evidence saved.`);
  };

  return (
    <main>
      <CrmPageHeader
        kicker="Sales · Won handover"
        title="Handover to Delivery"
        description="Confirm the six facts Delivery needs. Nothing is retyped and nothing external sends from this screen."
        actions={
          <Link href="/crm" className="crm-btn">
            ← Pipeline
          </Link>
        }
      />

      {deals.isLoading ? (
        <CrmEmpty title="Loading handovers…" />
      ) : deals.isError ? (
        <CrmEmpty title="Could not load handovers" hint={deals.error.message} />
      ) : candidates.length === 0 ? (
        <CrmEmpty
          title="No deals are ready for handover"
          hint="Deals appear here when they reach Win or close."
        />
      ) : !deal ? null : (
        <>
          <CrmFilterBar>
            <label className="crm-field min-w-[280px]">
              <span>Deal</span>
              <select
                className="crm-select"
                data-testid="handover-deal-select"
                value={deal.dealId}
                onChange={(event) => {
                  setDealId(event.target.value);
                  setStatus("");
                }}
              >
                {candidates.map((candidate) => (
                  <option key={candidate.dealId} value={candidate.dealId}>
                    {candidate.companyName} ·{" "}
                    {candidate.stage === "handover_pack"
                      ? "Handover started"
                      : "Win or close"}
                  </option>
                ))}
              </select>
            </label>
          </CrmFilterBar>

          <section className="crm-split">
            <div className="crm-panel" data-testid="handover-readiness">
              <div className="crm-panel-head">
                <div>
                  <h3>What Delivery needs · {readyCount} of 6</h3>
                  <p>{deal.companyName}</p>
                </div>
                <CrmTag kind={ready ? "success" : "warn"}>
                  {ready ? "Ready" : `${6 - readyCount} missing`}
                </CrmTag>
              </div>
              <div className="crm-panel-body">
                <div className="crm-checklist">
                  {checks.map((check) => (
                    <div
                      key={check.key}
                      className="crm-check-row"
                      data-testid={`handover-check-${check.key}`}
                      data-ready={check.ready ? "true" : "false"}
                    >
                      <span>
                        <strong aria-hidden="true">
                          {check.ready ? "✓" : "○"}
                        </strong>{" "}
                        {check.label}
                      </span>
                      <span>{check.detail}</span>
                    </div>
                  ))}
                </div>

                <div className="crm-form-grid mt-4">
                  <label className="crm-field">
                    <span>Brand assets evidence</span>
                    <input
                      className="crm-input"
                      data-testid="handover-brand-input"
                      placeholder="Drive folder or received status"
                      value={brandAssets}
                      onChange={(event) => setBrandAssets(event.target.value)}
                    />
                    <CrmBtn
                      disabled={!brandAssets.trim() || addNote.isPending}
                      onClick={() =>
                        void saveEvidence(
                          BRAND_PREFIX,
                          brandAssets,
                          () => setBrandAssets(""),
                          "Brand assets",
                        )
                      }
                    >
                      Save brand evidence
                    </CrmBtn>
                  </label>
                  <label className="crm-field">
                    <span>Billing details evidence</span>
                    <input
                      className="crm-input"
                      data-testid="handover-billing-input"
                      placeholder="Billing contact or TRN status"
                      value={billingDetails}
                      onChange={(event) =>
                        setBillingDetails(event.target.value)
                      }
                    />
                    <CrmBtn
                      disabled={!billingDetails.trim() || addNote.isPending}
                      onClick={() =>
                        void saveEvidence(
                          BILLING_PREFIX,
                          billingDetails,
                          () => setBillingDetails(""),
                          "Billing details",
                        )
                      }
                    >
                      Save billing evidence
                    </CrmBtn>
                  </label>
                </div>
                {status ? (
                  <div className="crm-note mt-3" role="status">
                    {status}
                  </div>
                ) : null}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="crm-panel">
                <div className="crm-panel-head">
                  <div>
                    <h3>On confirmation</h3>
                    <p>
                      The existing governed handover flow continues on the deal.
                    </p>
                  </div>
                </div>
                <div className="crm-panel-body">
                  <div className="crm-checklist">
                    <div className="crm-check-row">
                      Client record <span>created or reused</span>
                    </div>
                    <div className="crm-check-row">
                      Onboarding plan <span>prepared</span>
                    </div>
                    <div className="crm-check-row">
                      First invoice <span>proposed, not raised</span>
                    </div>
                    <div className="crm-check-row">
                      Portal invite and provider sends{" "}
                      <span>separate approval</span>
                    </div>
                  </div>
                  <div className="mt-4">
                    {ready ? (
                      <Link
                        href={`/crm/deals/${deal.dealId}#handover`}
                        data-testid="handover-primary-action"
                        className="crm-btn primary w-full"
                      >
                        {deal.stage === "handover_pack"
                          ? "Open handover"
                          : deal.closeOutcome === "won"
                            ? "Open deal and hand over"
                            : "Open deal to confirm win"}
                      </Link>
                    ) : (
                      <CrmBtn
                        variant="primary"
                        className="w-full"
                        data-testid="handover-primary-disabled"
                        disabled
                      >
                        Complete all six items
                      </CrmBtn>
                    )}
                  </div>
                </div>
              </div>

              <div className="crm-note" data-testid="handover-archive-gap">
                <strong>Archive is still a separate Mile 2 gap.</strong> This
                screen does not archive or delete deals; closed records remain
                searchable in the CRM.
              </div>
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
