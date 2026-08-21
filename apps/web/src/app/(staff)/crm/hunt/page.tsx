"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

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
  const [result, setResult] = useState<string | null>(null);
  const [query, setQuery] = useState("UAE retail brand");
  const utils = trpc.useUtils();
  const demo = trpc.crm.runDemoClosedLoop.useMutation({
    onSuccess: (data) => {
      if (!data.ok) {
        setResult(`Blocked at ${data.step}: ${data.reason}`);
        return;
      }
      setResult(
        `Closed loop ready — client ${data.clientName}. Open creative, then portal deliveries.`,
      );
    },
    onError: (err) => setResult(err.message),
  });
  const apolloImport = trpc.leads.apollo.import.useMutation({
    onSuccess: (deals) => {
      const n = Array.isArray(deals) ? deals.length : 0;
      setResult(
        n > 0
          ? `Apollo imported ${n} discover deal(s) — open pipeline to qualify.`
          : "Apollo returned no companies for that query.",
      );
      void utils.crm.deals.list.invalidate();
    },
    onError: (err) => setResult(err.message),
  });

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

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <input
                className="min-w-[220px] flex-1 rounded-full border border-sand bg-white px-4 py-2 text-sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Apollo search (mock without key)"
                aria-label="Prospecting query"
              />
              <button
                type="button"
                className="rounded-full border border-sand bg-white px-4 py-2 text-sm disabled:opacity-40"
                disabled={apolloImport.isPending || query.trim().length < 2}
                onClick={() => {
                  setResult(null);
                  apolloImport.mutate({ query: query.trim() });
                }}
              >
                {apolloImport.isPending ? "Searching…" : "Prospect with Apollo"}
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                disabled={demo.isPending}
                onClick={() => {
                  setResult(null);
                  demo.mutate({});
                }}
              >
                {demo.isPending
                  ? "Running demo loop…"
                  : "Run demo closed loop"}
              </button>
              {demo.data && demo.data.ok ? (
                <>
                  <Link
                    className="text-sm underline"
                    href={demo.data.next.crmDeal}
                  >
                    Deal
                  </Link>
                  <Link
                    className="text-sm underline"
                    href={demo.data.next.client}
                  >
                    Client
                  </Link>
                  <Link
                    className="text-sm underline"
                    href={demo.data.next.creative}
                  >
                    Creative
                  </Link>
                  <Link
                    className="text-sm underline"
                    href={demo.data.next.portal}
                  >
                    Portal
                  </Link>
                </>
              ) : null}
              <Link className="text-sm underline" href="/crm">
                Pipeline
              </Link>
            </div>
            {result ? (
              <p className="mt-3 text-sm text-muted" role="status">
                {result}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted">
              Apollo/Hunter auto-mock without keys; paste keys in Connections
              for live enrichment. Closed loop seeds prospect → won →
              onboarding + creative task.
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
              Connections <span aria-hidden>↗</span>
            </Link>
            <Link href="/settings/ai">
              Agents <span aria-hidden>↗</span>
            </Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}
