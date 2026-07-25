"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function StaffHomePage() {
  const overview = trpc.ops.overview.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (overview.isLoading) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-muted">
        Loading live operations…
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
  const metrics = [
    {
      label: "Active team",
      value: String(data.activePeople).padStart(2, "0"),
      detail: "People in the directory",
      href: "/people",
    },
    {
      label: "Open pipeline",
      value: String(data.openDeals).padStart(2, "0"),
      detail: "Commercial opportunities",
      href: "/crm",
    },
    {
      label: "Client work",
      value: String(data.openTasks).padStart(2, "0"),
      detail: `${data.activeClients} active clients`,
      href: "/delivery",
    },
    {
      label: "Connections",
      value: String(data.connectedTools).padStart(2, "0"),
      detail: "Tools connected securely",
      href: "/settings/connections",
    },
    {
      label: "Audit pulse",
      value: String(data.recentAudits).padStart(2, "0"),
      detail: "Recorded this week",
      href: "/admin/audit",
    },
  ];
  const dubaiDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Dubai",
  }).format(new Date());
  const latestActivity =
    data.latestAudit?.action.replace(/[._]/g, " ") ?? "No recent activity";

  return (
    <main className="ops-home">
      <section className="ops-hero">
        <div className="ops-hero-brand">
          hrmny <span>OS</span>
        </div>
        <div className="ops-hero-grid">
          <div className="ops-hero-copy-wrap">
            <p className="ops-eyebrow">{dubaiDate} · Dubai</p>
            <h1>
              One rhythm for <em>every</em> client relationship.
            </h1>
            <p className="ops-hero-copy">
              Good morning. {data.openTasks} open tasks are moving across{" "}
              {data.activeClients} active clients, with {data.openDeals}{" "}
              opportunities in the pipeline.
            </p>
            <div className="ops-hero-actions">
              <Link href="/client-preview" className="ops-btn ops-btn-ochre">
                Review client work →
              </Link>
              <Link href="/work" className="ops-btn">
                Open command center
              </Link>
            </div>
          </div>
          <div className="ops-orbit" aria-label="Live operating rhythm">
            <div className="ops-orbit-path" />
            <div className="ops-orbit-ring ops-orbit-ring-outer" />
            <div className="ops-orbit-ring ops-orbit-ring-inner" />
            <div className="ops-orbit-ring ops-orbit-ring-core" />
            <div className="ops-orbit-core">h</div>
            <div className="ops-orbit-node ops-orbit-node-1">
              CRM
              <br />
              {data.openDeals} open
            </div>
            <div className="ops-orbit-node ops-orbit-node-2">
              Delivery
              <br />
              {data.openTasks} open
            </div>
            <div className="ops-orbit-node ops-orbit-node-3">
              Tools
              <br />
              {data.connectedTools} live
            </div>
            <div className="ops-orbit-node ops-orbit-node-4">
              People
              <br />
              {data.activePeople} active
            </div>
          </div>
        </div>
        <div className="ops-hero-signal">
          <span /> all systems in rhythm
        </div>
      </section>

      <div className="ops-section-kicker">
        <h2>Pulse, not noise</h2>
        <Link href="/crm">Open full pipeline →</Link>
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

      <div className="ops-section-kicker ops-section-kicker-rhythm">
        <h2>Today’s operating rhythm</h2>
        <span>
          Updated{" "}
          {new Date(data.updatedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <section className="ops-split">
        <article className="ops-panel">
          <header className="ops-panel-head">
            <div>
              <h3>Work moving today</h3>
              <p>Across the live operating system</p>
            </div>
            <Link href="/work">View board →</Link>
          </header>
          <div className="ops-panel-body ops-rhythm-list">
            <Link href="/people" className="ops-rhythm-row">
              <span className="ops-date-box">
                01<small>Team</small>
              </span>
              <span>
                <strong>People directory</strong>
                <small>{data.activePeople} active employees are visible</small>
              </span>
              <span className="ops-tag ops-tag-success">Live</span>
            </Link>
            <Link href="/crm" className="ops-rhythm-row">
              <span className="ops-date-box">
                02<small>CRM</small>
              </span>
              <span>
                <strong>Commercial pipeline</strong>
                <small>{data.openDeals} open opportunities need momentum</small>
              </span>
              <span className="ops-tag ops-tag-info">Open</span>
            </Link>
            <Link href="/delivery" className="ops-rhythm-row">
              <span className="ops-date-box">
                03<small>Work</small>
              </span>
              <span>
                <strong>Client delivery</strong>
                <small>
                  {data.openTasks} tasks across {data.activeClients} clients
                </small>
              </span>
              <span className="ops-tag ops-tag-ochre">Moving</span>
            </Link>
            <Link href="/settings/connections" className="ops-rhythm-row">
              <span className="ops-date-box">
                04<small>Tools</small>
              </span>
              <span>
                <strong>Connected workspace</strong>
                <small>
                  {data.connectedTools} authorized connections available
                </small>
              </span>
              <span className="ops-tag">Review</span>
            </Link>
          </div>
        </article>

        <article className="ops-panel">
          <header className="ops-panel-head">
            <div>
              <h3>Waiting on you</h3>
              <p>Human approval, always</p>
            </div>
          </header>
          <div className="ops-panel-body ops-approval-stack">
            <Link href="/client-preview" className="ops-approval-mini">
              <div>
                <span className="ops-tag ops-tag-ochre">Client</span>
                <small>Preview</small>
              </div>
              <h4>Demo Co · delivery approval</h4>
              <p>Review the client-safe experience and persistent decision.</p>
              <span className="ops-progress">
                <i style={{ width: "76%" }} />
              </span>
            </Link>
            <Link href="/settings/connections" className="ops-approval-mini">
              <div>
                <span className="ops-tag ops-tag-info">Tools</span>
                <small>{data.connectedTools} live</small>
              </div>
              <h4>Personal connections</h4>
              <p>Connect, verify, or disconnect approved business tools.</p>
              <span className="ops-progress">
                <i style={{ width: "52%" }} />
              </span>
            </Link>
            <Link href="/admin/audit" className="ops-approval-mini">
              <div>
                <span className="ops-tag ops-tag-success">Audit</span>
                <small>{data.recentAudits} this week</small>
              </div>
              <h4>{latestActivity}</h4>
              <p>Latest recorded operational activity.</p>
              <span className="ops-progress">
                <i style={{ width: "88%" }} />
              </span>
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
