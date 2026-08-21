"use client";

import Link from "next/link";

const STEPS = [
  {
    href: "/crm/inbound",
    index: "01",
    title: "Capture inbound",
    body: "Triaged signals, forms, and warm intros land here first.",
  },
  {
    href: "/crm/outreach",
    index: "02",
    title: "Draft outreach",
    body: "Human-approved messages — never auto-sent.",
  },
  {
    href: "/crm/companies",
    index: "03",
    title: "Qualify companies",
    body: "Firmographics, temperature, and next best action.",
  },
  {
    href: "/crm",
    index: "04",
    title: "Move the pipeline",
    body: "Guarded stage moves from first signal to handover.",
  },
] as const;

export default function HuntClientsPage() {
  return (
    <main className="ops-home">
      <section className="ops-command" aria-labelledby="hunt-title">
        <div className="ops-command-atmosphere" aria-hidden />
        <header className="ops-command-header">
          <div className="ops-brand" aria-label="hrmny hunt">
            hrmny <span>hunt</span>
          </div>
          <p>Growth path</p>
        </header>

        <div className="ops-command-main">
          <div className="ops-command-intro">
            <p className="ops-eyebrow">Clear path</p>
            <h1 id="hunt-title">
              Hunt clients in <em>four moves.</em>
            </h1>
            <p className="ops-support">
              Follow the sequence. Each step opens the exact workspace — no
              scavenger hunt through the nav.
            </p>
          </div>

          <nav className="ops-job-paths" aria-label="Hunt sequence">
            {STEPS.map((step) => (
              <Link key={step.href} href={step.href} className="ops-job-path">
                <span className="ops-job-index">
                  {step.index} / Hunt
                </span>
                <span className="ops-job-copy">
                  <strong>{step.title}</strong>
                  <small>{step.body}</small>
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
            <Link href="/crm/tasks">
              Sales tasks <span aria-hidden>↗</span>
            </Link>
            <Link href="/crm/activities">
              Activities <span aria-hidden>↗</span>
            </Link>
            <Link href="/settings/connections">
              Connect Apollo / Hunter <span aria-hidden>↗</span>
            </Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}
