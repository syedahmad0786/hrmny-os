"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

type JobPath = {
  href: string;
  index: string;
  title: string;
  description: string;
};

const JOB_PATHS = [
  {
    href: "/crm",
    index: "01 / Growth",
    title: "Hunt clients",
    description: "Qualify inbound leads and move outreach in CRM.",
  },
  {
    href: "/tasks",
    index: "02 / Focus",
    title: "My tasks",
    description: "See assigned work, sales follow-ups, and delivery tasks.",
  },
  {
    href: "/delivery",
    index: "03 / Delivery",
    title: "Deliver work",
    description: "Move briefs, creative, approvals, and client assets.",
  },
] as const satisfies readonly JobPath[];

const QUICK_PATHS = [
  { href: "/approvals", label: "Approve work" },
  { href: "/creative", label: "Make creative" },
  { href: "/chat", label: "Ask AI" },
  { href: "/tickets", label: "Resolve tickets" },
  { href: "/settings/connections", label: "Connect tools" },
] as const;

function JobPathLink({ path }: { path: JobPath }) {
  return (
    <Link href={path.href} className="ops-job-path">
      <span className="ops-job-index">{path.index}</span>
      <span className="ops-job-copy">
        <strong>{path.title}</strong>
        <small>{path.description}</small>
      </span>
      <span className="ops-job-arrow" aria-hidden>
        ↗
      </span>
    </Link>
  );
}

export default function StaffHomePage() {
  const overview = trpc.ops.overview.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const data = overview.data;
  const dubaiDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Dubai",
  }).format(new Date());
  const updatedAt = data
    ? new Date(data.updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const metricStatus = overview.error
    ? "Live metrics unavailable"
    : updatedAt
      ? `Updated ${updatedAt}`
      : "Connecting to live operations";

  return (
    <main className="ops-home">
      <section className="ops-command" aria-labelledby="ops-home-title">
        <div className="ops-command-atmosphere" aria-hidden />

        <header className="ops-command-header">
          <div className="ops-brand" aria-label="hrmny OS">
            hrmny <span>OS</span>
          </div>
          <p>{dubaiDate} · Dubai</p>
        </header>

        <div className="ops-command-main">
          <div className="ops-command-intro">
            <p className="ops-eyebrow">Your operating system</p>
            <h1 id="ops-home-title">
              Find clients. Move work. <em>Deliver well.</em>
            </h1>
            <p className="ops-support">
              Choose what needs momentum, then go straight to the work.
            </p>
          </div>

          <nav className="ops-job-paths" aria-label="Start work">
            {JOB_PATHS.map((path) => (
              <JobPathLink key={path.href} path={path} />
            ))}
          </nav>
        </div>

        <footer className="ops-command-footer">
          <nav className="ops-quick-paths" aria-label="More operations">
            <span>Quick paths</span>
            {QUICK_PATHS.map((path) => (
              <Link key={path.href} href={path.href}>
                {path.label} <span aria-hidden>↗</span>
              </Link>
            ))}
          </nav>

          <section className="ops-live-pulse" aria-label="Live operations">
            <p aria-live="polite">
              <span className={overview.error ? "is-offline" : ""} />
              {metricStatus}
            </p>
            <dl>
              <div>
                <dt>Pipeline</dt>
                <dd>{data?.openDeals ?? "—"}</dd>
              </div>
              <div>
                <dt>Tasks</dt>
                <dd>{data?.openTasks ?? "—"}</dd>
              </div>
              <div>
                <dt>Clients</dt>
                <dd>{data?.activeClients ?? "—"}</dd>
              </div>
            </dl>
          </section>
        </footer>
      </section>
    </main>
  );
}
