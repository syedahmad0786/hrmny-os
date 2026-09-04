"use client";

import Link from "next/link";
import { useMemo } from "react";
import { DashStrip } from "../_components/dash-strip";
import {
  CompanyCell,
  CrmEmpty,
  CrmPageHeader,
  CrmTag,
} from "@/components/crm/ui";
import {
  formatContactName,
  formatRelative,
  initials,
} from "@/components/crm/format";
import { isSyntheticRecordName } from "@/lib/synthetic-records";
import { trpc } from "@/lib/trpc";

export default function SalesDashboardPage() {
  const digest = trpc.salesOs.digest.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const deals = trpc.crm.deals.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const contacts = trpc.crm.contacts.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const stages = trpc.crm.stages.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const contactById = useMemo(
    () =>
      new Map(
        (contacts.data ?? []).map((contact) => [contact.contactId, contact]),
      ),
    [contacts.data],
  );
  const activeDeals = useMemo(
    () =>
      (deals.data ?? [])
        .filter(
          (deal) =>
            !deal.closeOutcome && !isSyntheticRecordName(deal.companyName),
        )
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )
        .slice(0, 7),
    [deals.data],
  );
  const queue = [
    {
      label: "Follow-ups due",
      count: digest.data?.followUps.due,
      detail: "Prepare the next touch, review it, then approve the send.",
      href: "/crm/outreach",
    },
    {
      label: "Approved emails ready",
      count: digest.data?.outreachApproved,
      detail: "A person still chooses Send; nothing is sent automatically.",
      href: "/crm/outreach",
    },
    {
      label: "Drafts to review",
      count: digest.data?.outreachDrafts,
      detail: "Check the recipient, angle and evidence before approval.",
      href: "/crm/outreach",
    },
    {
      label: "Company research waiting",
      count: digest.data?.researchedWaiting,
      detail: "Approve the research or send it back for stronger evidence.",
      href: "/crm/research",
    },
    {
      label: "People to qualify",
      count: digest.data?.contactsWaiting,
      detail: "Confirm the right decision-maker before writing outreach.",
      href: "/crm/research",
    },
    {
      label: "Stalled pipeline leads",
      count: digest.data?.stalled.length,
      detail: "Move the deal, record the next action or close the loop.",
      href: "/crm/deals",
    },
  ];
  const pulse = [
    ["Emails sent", digest.data?.replyRate.sent],
    ["Replies", digest.data?.replyRate.replied],
    [
      "Reply rate",
      digest.data
        ? `${Math.round(digest.data.replyRate.rate * 100)}%`
        : undefined,
    ],
    ["Scheduled follow-ups", digest.data?.followUps.scheduled],
    ["Awaiting review", digest.data?.followUps.awaitingReview],
  ] as const;

  return (
    <main data-testid="sales-dashboard">
      <CrmPageHeader
        kicker="Sales · Live operating view"
        title="Sales command center"
        description="One place to see what needs attention across research, outreach, follow-ups and the CRM pipeline. Counts read directly from the same records used by each Sales screen."
        actions={
          <>
            <Link className="crm-btn primary" href="/crm/hunt">
              Find new clients
            </Link>
            <Link className="crm-btn" href="/crm">
              Open pipeline
            </Link>
          </>
        }
      />

      {digest.error ? (
        <p className="crm-note mb-4" role="alert">
          The sales queue is temporarily unavailable: {digest.error.message}
        </p>
      ) : null}

      <section
        className="crm-panel mb-4 overflow-hidden"
        aria-labelledby="sales-queue-heading"
        data-testid="sales-dashboard-queue"
      >
        <div className="crm-panel-head justify-between py-4">
          <div>
            <p className="growth-kicker">Do next</p>
            <h2
              id="sales-queue-heading"
              className="font-display text-[21px] font-semibold tracking-[-0.025em]"
            >
              Today&apos;s sales queue
            </h2>
          </div>
          <CrmTag kind={digest.isFetching ? "warn" : "success"}>
            {digest.isFetching ? "Syncing" : "Synced · 30s"}
          </CrmTag>
        </div>
        <div className="grid gap-px bg-[var(--line)] md:grid-cols-2">
          {queue.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={`grid min-h-[82px] grid-cols-[28px_minmax(0,1fr)_auto_18px] items-center gap-3 bg-[var(--paper-2)] px-[18px] py-4 text-[var(--ink)] hover:bg-[var(--muted-surface-soft)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--ochre)] ${item.count && item.count > 0 ? "border-l-[3px] border-l-[var(--ochre)]" : ""}`}
            >
              <span className="font-mono text-[9px] font-bold text-[var(--ochre-dark)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <strong className="block text-xs">{item.label}</strong>
                <small className="mt-1 block text-[9px] leading-[1.45] text-[var(--muted)]">
                  {item.detail}
                </small>
              </span>
              <b className="min-w-[34px] text-right font-display text-[26px] font-semibold leading-none">
                {item.count ?? "…"}
              </b>
              <span aria-hidden>→</span>
            </Link>
          ))}
        </div>
      </section>

      <section
        className="mb-[18px] grid gap-6 rounded-[18px] bg-[var(--ink)] p-5 text-[var(--paper)] lg:grid-cols-[minmax(190px,0.65fr)_minmax(0,2fr)] lg:items-center"
        aria-labelledby="outreach-pulse-heading"
        data-testid="sales-dashboard-outreach-pulse"
      >
        <div>
          <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-[rgba(247,244,239,0.52)]">
            Tracking &amp; monitoring
          </p>
          <h2
            id="outreach-pulse-heading"
            className="mt-1.5 font-display text-[21px] font-semibold leading-tight"
          >
            Outreach pulse
          </h2>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {pulse.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[8px] uppercase tracking-[0.08em] text-[rgba(247,244,239,0.52)]">
                {label}
              </dt>
              <dd className="mt-2 font-display text-2xl font-semibold leading-none">
                {value ?? "…"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="revenue-heading">
        <div className="flex items-center justify-between gap-4 pb-3 pt-2">
          <div>
            <p className="growth-kicker">Pipeline health</p>
            <h2
              id="revenue-heading"
              className="font-display text-[21px] font-semibold tracking-[-0.025em]"
            >
              Revenue &amp; forecast
            </h2>
          </div>
        </div>
        <DashStrip refetchInterval={30_000} />
      </section>

      <section className="crm-panel" aria-labelledby="active-pipeline-heading">
        <div className="crm-panel-head justify-between">
          <div>
            <h3 id="active-pipeline-heading">Current pipeline work</h3>
            <p>Most recently updated real leads, with their next stage job.</p>
          </div>
          <Link
            href="/crm/deals"
            className="text-[10px] font-bold underline underline-offset-4"
          >
            View all deals →
          </Link>
        </div>
        {deals.error ? (
          <p className="crm-note m-4" role="alert">
            Pipeline leads are temporarily unavailable: {deals.error.message}
          </p>
        ) : deals.isLoading ? (
          <CrmEmpty title="Loading pipeline…" />
        ) : activeDeals.length === 0 ? (
          <CrmEmpty
            title="No active leads yet"
            hint="Find a client and add them to the pipeline to start the sales loop."
          />
        ) : (
          <ol className="m-0 list-none divide-y divide-[var(--line)] p-0">
            {activeDeals.map((deal, index) => {
              const contact = deal.primaryContactId
                ? contactById.get(deal.primaryContactId)
                : null;
              const leadName = formatContactName(contact);
              const stage = stages.data?.find(
                (item) => item.key === deal.stage,
              );
              return (
                <li key={deal.dealId}>
                  <Link
                    href={`/crm/deals/${deal.dealId}`}
                    className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 px-[18px] py-[13px] text-[var(--ink)] hover:bg-[var(--muted-surface-soft)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--ochre)] lg:grid-cols-[28px_minmax(190px,0.9fr)_minmax(230px,1.25fr)_auto_18px] lg:items-center"
                  >
                    <span className="font-mono text-[9px] font-bold text-[var(--ochre-dark)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <CompanyCell
                      name={leadName ?? "Lead name unavailable"}
                      subtitle={deal.companyName}
                      mark={initials(leadName ?? deal.companyName)}
                    />
                    <span className="col-start-2 col-end-[-1] lg:col-auto">
                      <CrmTag kind="info">
                        {stage?.label ?? deal.stage.replace(/_/g, " ")}
                      </CrmTag>
                      <small className="mt-1 block text-[9px] leading-[1.4] text-[var(--muted)]">
                        {stage?.description ??
                          "Open the lead for its next action."}
                      </small>
                    </span>
                    <time
                      dateTime={deal.updatedAt}
                      className="col-start-2 text-[9px] text-[var(--muted)] lg:col-auto"
                    >
                      {formatRelative(deal.updatedAt)}
                    </time>
                    <span
                      className="col-start-3 row-start-3 lg:col-auto lg:row-auto"
                      aria-hidden
                    >
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
