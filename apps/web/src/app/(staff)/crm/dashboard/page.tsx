"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import type { CrmMarket } from "@/lib/crm-markets";

export default function SalesDashboardPage() {
  const [market, setMarket] = useState<CrmMarket | "">("");
  const [owner, setOwner] = useState("");
  const [channel, setChannel] = useState("");
  const [campaign, setCampaign] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
  const tasks = trpc.crm.tasks.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const activities = trpc.crm.activities.list.useQuery(
    { limit: 200 },
    { refetchInterval: 30_000 },
  );
  const session = trpc.auth.session.useQuery();
  const funnel = trpc.salesOs.funnel.useQuery(
    {
      market: market || undefined,
      owner: owner || undefined,
      channel: channel || undefined,
      campaign: campaign || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { refetchInterval: 30_000 },
  );

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
  const dealById = useMemo(
    () => new Map((deals.data ?? []).map((deal) => [deal.dealId, deal])),
    [deals.data],
  );
  const actionGroups = useMemo(() => {
    const employeeId =
      session.data?.actorType === "staff" ? session.data.employeeId : null;
    const waiting = (tasks.data ?? [])
      .filter(
        (task) =>
          task.dealId &&
          task.ownerEmployeeId === employeeId &&
          task.status !== "done" &&
          task.status !== "cancelled",
      )
      .sort((a, b) => {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      })
      .slice(0, 3)
      .flatMap((task) => {
        const deal = task.dealId ? dealById.get(task.dealId) : null;
        return deal && !isSyntheticRecordName(deal.companyName)
          ? [
              {
                id: `task-${task.crmTaskId}`,
                dealId: deal.dealId,
                title: deal.companyName,
                detail: `${task.title}${task.dueDate ? ` · due ${new Date(task.dueDate).toLocaleDateString("en-AE", { day: "numeric", month: "short" })}` : " · date needed"}`,
              },
            ]
          : [];
      });
    const stalled = (digest.data?.stalled ?? []).slice(0, 3).map((item) => ({
      id: `stalled-${item.dealId}`,
      dealId: item.dealId,
      title: item.companyName,
      detail: `${item.daysInStage} days in ${item.stage.replace(/_/g, " ")} · expected max ${item.maxDays}`,
    }));
    const weekAgo = Date.now() - 7 * 86_400_000;
    const seen = new Set<string>();
    const moving = (activities.data ?? [])
      .filter(
        (activity) =>
          activity.dealId &&
          activity.type === "stage_change" &&
          new Date(activity.createdAt).getTime() >= weekAgo,
      )
      .flatMap((activity) => {
        if (!activity.dealId || seen.has(activity.dealId)) return [];
        seen.add(activity.dealId);
        const deal = dealById.get(activity.dealId);
        return deal && !isSyntheticRecordName(deal.companyName)
          ? [
              {
                id: `moving-${activity.dealId}`,
                dealId: activity.dealId,
                title: deal.companyName,
                detail: `${String(deal.stage).replace(/_/g, " ")} · moved ${formatRelative(activity.createdAt)}`,
              },
            ]
          : [];
      })
      .slice(0, 3);
    const closing = (deals.data ?? [])
      .filter(
        (deal) =>
          !deal.closeOutcome &&
          ["propose", "price_cost", "close"].includes(String(deal.stage)) &&
          !isSyntheticRecordName(deal.companyName),
      )
      .sort((a, b) => Number(b.quoteValue ?? 0) - Number(a.quoteValue ?? 0))
      .slice(0, 3)
      .map((deal) => ({
        id: `closing-${deal.dealId}`,
        dealId: deal.dealId,
        title: deal.companyName,
        detail: `${String(deal.stage).replace(/_/g, " ")} · ${new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(Number(deal.quoteValue ?? 0))}`,
      }));
    return [
      { label: "Waiting on me", items: waiting },
      { label: "Stalled", items: stalled },
      { label: "Moving this week", items: moving },
      { label: "Closing", items: closing },
    ];
  }, [
    activities.data,
    dealById,
    deals.data,
    digest.data?.stalled,
    session.data,
    tasks.data,
  ]);
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
            <Link className="crm-btn" href="/crm/campaigns">
              Campaigns
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
        aria-labelledby="sales-actions-heading"
        data-testid="sales-action-groups"
      >
        <div className="crm-panel-head justify-between py-4">
          <div>
            <p className="growth-kicker">Sales</p>
            <h2
              id="sales-actions-heading"
              className="font-display text-[28px] font-semibold tracking-[-0.035em]"
            >
              {actionGroups.reduce((sum, group) => sum + group.items.length, 0)}{" "}
              things need you
            </h2>
          </div>
          <CrmTag kind={digest.isFetching ? "warn" : "success"}>
            {digest.isFetching ? "Syncing" : "Live"}
          </CrmTag>
        </div>
        <div className="grid gap-px bg-[var(--line)] md:grid-cols-2">
          {actionGroups.map((group) => (
            <div key={group.label} className="bg-[var(--paper-2)] p-[18px]">
              <h3 className="mb-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                {group.label} · {group.items.length}
              </h3>
              {group.items.length ? (
                <ol className="m-0 list-none divide-y divide-[var(--line)] p-0">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/crm/deals/${item.dealId}`}
                        className="grid grid-cols-[minmax(0,1fr)_18px] gap-3 py-3 text-[var(--ink)] hover:text-[var(--ochre-dark)]"
                      >
                        <span>
                          <strong className="block text-xs">
                            {item.title}
                          </strong>
                          <small className="mt-1 block text-[9px] leading-[1.45] text-[var(--muted)]">
                            {item.detail}
                          </small>
                        </span>
                        <span aria-hidden>→</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-3 text-[10px] text-[var(--muted)]">
                  Nothing here right now.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section
        className="crm-panel mb-4 overflow-hidden"
        aria-labelledby="sales-queue-heading"
        data-testid="sales-dashboard-queue"
      >
        <div className="crm-panel-head justify-between py-4">
          <div>
            <p className="growth-kicker">System queues</p>
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

      <section
        className="crm-panel mb-4 overflow-hidden"
        aria-labelledby="sales-funnel-heading"
        data-testid="sales-funnel"
      >
        <div className="crm-panel-head block py-4">
          <p className="growth-kicker">Conversion funnel</p>
          <h2
            id="sales-funnel-heading"
            className="font-display text-[21px] font-semibold tracking-[-0.025em]"
          >
            From lead to won
          </h2>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            Filter the same live CRM, research, outreach and email-event
            records.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="crm-field">
              <span>Market</span>
              <select
                className="crm-input"
                value={market}
                onChange={(event) =>
                  setMarket(event.target.value as CrmMarket | "")
                }
              >
                <option value="">All markets</option>
                {funnel.data?.options.markets.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="crm-field">
              <span>Owner</span>
              <select
                className="crm-input"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
              >
                <option value="">All owners</option>
                {funnel.data?.options.owners.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="crm-field">
              <span>Channel</span>
              <select
                className="crm-input"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="">All channels</option>
                {funnel.data?.options.channels.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="crm-field">
              <span>Campaign / source</span>
              <select
                className="crm-input"
                value={campaign}
                onChange={(event) => setCampaign(event.target.value)}
              >
                <option value="">All sources</option>
                {funnel.data?.options.campaigns.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="crm-field">
              <span>Created from</span>
              <input
                className="crm-input"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label className="crm-field">
              <span>Created to</span>
              <input
                className="crm-input"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
          </div>
        </div>
        {funnel.error ? (
          <p className="crm-note m-4" role="alert">
            Funnel unavailable: {funnel.error.message}
          </p>
        ) : (
          <div className="grid gap-6 p-[18px] lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,0.7fr)]">
            <ol className="m-0 grid list-none gap-3 p-0">
              {(funnel.data?.steps ?? []).map((item, index) => (
                <li
                  key={item.key}
                  className="grid grid-cols-[24px_minmax(0,1fr)_46px] items-center gap-3"
                >
                  <span className="font-mono text-[9px] font-bold text-[var(--ochre-dark)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="mb-1 flex justify-between gap-3 text-[10px]">
                      <strong>{item.label}</strong>
                      <span>{item.percentOfLeads}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--muted-surface-soft)]">
                      <div
                        className="h-full rounded-full bg-[var(--ochre)]"
                        style={{ width: `${item.percentOfLeads}%` }}
                      />
                    </div>
                  </div>
                  <strong className="text-right font-display text-xl">
                    {item.count}
                  </strong>
                </li>
              ))}
            </ol>
            <div className="rounded-xl bg-[var(--muted-surface-soft)] p-4">
              <p className="growth-kicker">Email evidence</p>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {[
                  ["Gmail accepted", funnel.data?.evidence.providerAccepted],
                  ["Replies", funnel.data?.evidence.replied],
                  ["Bounces", funnel.data?.evidence.bounced],
                  ["Complaints", funnel.data?.evidence.complained],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-[9px] text-[var(--muted)]">{label}</dt>
                    <dd className="mt-1 font-display text-2xl font-semibold">
                      {value ?? "…"}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[9px] leading-[1.5] text-[var(--muted)]">
                Gmail accepted means the exact message was read back from Sent
                Mail. It is not proof of delivery; bounces, complaints and
                replies are tracked separately.
              </p>
            </div>
          </div>
        )}
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
