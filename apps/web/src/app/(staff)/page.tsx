"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { usePageTitle } from "@/components/use-page-title";

type ActionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  urgency: "now" | "soon" | "watch";
  tag: string;
};

export default function StaffHomePage() {
  usePageTitle("Today");
  const overview = trpc.ops.overview.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const myTasks = trpc.work.personal.myTasks.useQuery(
    { includeCompleted: false },
    {
      retry: false,
      staleTime: 30_000,
    },
  );
  const deals = trpc.crm.deals.list.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });

  if (overview.isLoading) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-muted">
        Loading your action queue…
      </main>
    );
  }
  if (overview.error || !overview.data) {
    return (
      <main className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
        Live operations could not be loaded. {overview.error?.message}
      </main>
    );
  }

  const data = overview.data;
  const dubaiDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Dubai",
  }).format(new Date());

  const openDeals = (deals.data ?? []).filter((d) => !d.closeOutcome);
  const stalledDeals = openDeals.slice(0, 3);
  const taskRows = myTasks.data ?? [];
  const dueTasks = taskRows.slice(0, 5);

  const actions: ActionItem[] = [];

  for (const task of dueTasks) {
    actions.push({
      id: `task-${task.itemId}`,
      title: task.title,
      detail: task.dueAt
        ? `Due ${new Date(task.dueAt).toLocaleDateString()}`
        : "In your My tasks queue",
      href: "/work/my-tasks",
      urgency: "now",
      tag: "Task",
    });
  }

  for (const deal of stalledDeals) {
    actions.push({
      id: `deal-${deal.dealId}`,
      title: deal.companyName,
      detail: `Move ${deal.stage ?? "pipeline"} deal forward`,
      href: `/crm/deals/${deal.dealId}`,
      urgency: "soon",
      tag: "Deal",
    });
  }

  if (data.connectedTools === 0) {
    actions.push({
      id: "connections",
      title: "Connect your tools",
      detail: "Gmail, calendar, and CRM enrichment need a connection",
      href: "/settings/connections",
      urgency: "watch",
      tag: "Setup",
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: "pipeline",
      title: "Review the pipeline",
      detail: `${data.openDeals} open opportunities`,
      href: "/crm",
      urgency: "soon",
      tag: "CRM",
    });
    actions.push({
      id: "work",
      title: "Open My tasks",
      detail: `${data.openTasks} delivery tasks across clients`,
      href: "/work/my-tasks",
      urgency: "now",
      tag: "Work",
    });
  }

  const metrics = [
    {
      label: "Open deals",
      value: String(data.openDeals),
      detail: "Need a next step",
      href: "/crm",
    },
    {
      label: "Open tasks",
      value: String(data.openTasks),
      detail: `${data.activeClients} active clients`,
      href: "/work/my-tasks",
    },
    {
      label: "Approvals / audit",
      value: String(data.recentAudits),
      detail: "Recorded this week",
      href: "/approvals",
    },
    {
      label: "Connections",
      value: String(data.connectedTools),
      detail: "Tools ready to use",
      href: "/settings/connections",
    },
  ];

  return (
    <main className="ops-home">
      <section className="ops-today-hero">
        <p className="ops-eyebrow">{dubaiDate} · Dubai</p>
        <h1>What needs you today</h1>
        <p className="ops-hero-copy">
          {data.openTasks} open tasks · {data.openDeals} deals in motion ·{" "}
          {data.activeClients} active clients. Start with the queue below — not
          the orbit.
        </p>
        <div className="ops-hero-actions">
          <Link href="/work/my-tasks" className="ops-btn ops-btn-ochre">
            My tasks →
          </Link>
          <Link href="/crm" className="ops-btn">
            Open pipeline
          </Link>
          <Link href="/approvals" className="ops-btn">
            Approvals
          </Link>
        </div>
      </section>

      <div className="ops-section-kicker">
        <h2>Action queue</h2>
        <Link href="/work/my-tasks">Full task list →</Link>
      </div>
      <section className="ops-action-queue" aria-label="Actions needing you">
        {actions.map((action) => (
          <Link
            key={action.id}
            href={action.href}
            className={`ops-action-row urgency-${action.urgency}`}
          >
            <span className="ops-tag ops-tag-ochre">{action.tag}</span>
            <span>
              <strong>{action.title}</strong>
              <small>{action.detail}</small>
            </span>
            <span className="ops-action-go">Open →</span>
          </Link>
        ))}
      </section>

      <div className="ops-section-kicker">
        <h2>Pulse</h2>
        <span>
          Updated{" "}
          {new Date(data.updatedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <section className="ops-metric-grid">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="ops-metric">
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </Link>
        ))}
      </section>

      <div className="ops-section-kicker">
        <h2>Jump back in</h2>
        <Link href="/dashboards">All dashboards →</Link>
      </div>
      <section className="ops-jump-grid">
        <Link href="/delivery" className="ops-jump-card">
          <strong>Delivery board</strong>
          <small>Traffic, creative QC, account rhythm</small>
        </Link>
        <Link href="/finance" className="ops-jump-card">
          <strong>Money</strong>
          <small>Intake, billing, margin</small>
        </Link>
        <Link href="/people" className="ops-jump-card">
          <strong>People</strong>
          <small>Directory, leave, payroll prep</small>
        </Link>
        <Link href="/settings/connections" className="ops-jump-card">
          <strong>Connections</strong>
          <small>Gmail, Apollo, Xero, Composio</small>
        </Link>
      </section>
    </main>
  );
}
