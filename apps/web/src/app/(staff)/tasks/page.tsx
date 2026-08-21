"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

const PATHS = [
  {
    href: "/work/my-tasks",
    index: "01 / Personal",
    title: "My work tasks",
    body: "Assigned items across Work projects.",
  },
  {
    href: "/crm/tasks",
    index: "02 / Sales",
    title: "CRM follow-ups",
    body: "Deal tasks and next actions in the pipeline.",
  },
  {
    href: "/delivery",
    index: "03 / Delivery",
    title: "Client delivery board",
    body: "Capacity, traffic, creative QC, and briefs.",
  },
  {
    href: "/approvals",
    index: "04 / Gate",
    title: "Approvals waiting",
    body: "Outreach sends, campaign publish, portal sign-off.",
  },
] as const;

export default function TasksHubPage() {
  const work = trpc.work.personal.myTasks.useQuery({}, { retry: false });
  const crmTasks = trpc.crm.tasks.list.useQuery(undefined, { retry: false });

  return (
    <main className="ops-home">
      <section className="ops-command" aria-labelledby="tasks-title">
        <div className="ops-command-atmosphere" aria-hidden />
        <header className="ops-command-header">
          <div className="ops-brand">
            hrmny <span>tasks</span>
          </div>
          <p>
            {work.isError ? "—" : `${work.data?.length ?? "…"} work`} ·{" "}
            {crmTasks.isError ? "—" : `${crmTasks.data?.length ?? "…"} CRM`}
          </p>
        </header>

        <div className="ops-command-main">
          <div className="ops-command-intro">
            <p className="ops-eyebrow">Clear path</p>
            <h1 id="tasks-title">
              See the work. <em>Pick a lane.</em>
            </h1>
            <p className="ops-support">
              Personal, sales, delivery, and approvals — each with one door.
              Run agents on command from AI settings with a client sandbox.
            </p>
            <p className="mt-4">
              <Link
                className="rounded-full border border-sand bg-white px-4 py-2 text-sm"
                href="/settings/ai"
              >
                Run agents on command →
              </Link>
            </p>
          </div>

          <nav className="ops-job-paths" aria-label="Task lanes">
            {PATHS.map((path) => (
              <Link key={path.href} href={path.href} className="ops-job-path">
                <span className="ops-job-index">{path.index}</span>
                <span className="ops-job-copy">
                  <strong>{path.title}</strong>
                  <small>{path.body}</small>
                </span>
                <span className="ops-job-arrow" aria-hidden>
                  ↗
                </span>
              </Link>
            ))}
          </nav>
        </div>

        <footer className="ops-command-footer">
          <nav className="ops-quick-paths" aria-label="Related">
            <span>Also</span>
            <Link href="/work">
              Work board <span aria-hidden>↗</span>
            </Link>
            <Link href="/traffic">
              Traffic / DoR <span aria-hidden>↗</span>
            </Link>
            <Link href="/creative">
              Creative <span aria-hidden>↗</span>
            </Link>
            <Link href="/chat">
              Ask Hrmny <span aria-hidden>↗</span>
            </Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}
