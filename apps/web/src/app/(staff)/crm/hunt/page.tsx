"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  demoBlockerConnectionsPath,
  prioritizeDemoBlockers,
} from "@/lib/demo-blocker-anchor";
import { formatReadyLlmLine, type ReadySmoke } from "@/lib/ready-smoke";
import { ResearchConsole } from "../_components/research-console";

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
  const [lastApolloDealId, setLastApolloDealId] = useState<string | null>(null);
  const [ready, setReady] = useState<ReadySmoke | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ready")
      .then((r) => r.json())
      .then((body: ReadySmoke) => {
        if (!cancelled) setReady(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toolReady = ready?.tools ?? null;
  const blockers: string[] = ready?.blockers ?? [];
  const orderedBlockers = prioritizeDemoBlockers(blockers);
  const demo = trpc.crm.runDemoClosedLoop.useMutation({
    onSuccess: (data) => {
      if (!data.ok) {
        setResult(`Blocked at ${data.step}: ${data.reason}`);
        return;
      }
      const via = data.viaApollo
        ? ` via Apollo (${data.apolloMode ?? "mock"})`
        : "";
      setResult(
        `Closed loop ready${via} — client ${data.clientName}${
          data.calendarId ? " · content calendar seeded" : ""
        }${
          "outreachId" in data && data.outreachId
            ? " · outreach draft queued"
            : ""
        }. Open Outreach, Account, Creative, then portal.`,
      );
      void utils.crm.deals.list.invalidate();
      void utils.leadgen.outreach.invalidate();
      void utils.m4.seedIds.invalidate();
      void utils.calendars.invalidate();
      void utils.clients.invalidate();
    },
    onError: (err) => setResult(err.message),
  });
  const apolloImport = trpc.crm.prospect.apolloImport.useMutation({
    onSuccess: (payload) => {
      const n = payload.deals.length;
      const first = payload.deals[0];
      setLastApolloDealId(first?.dealId ?? null);
      setResult(
        n > 0
          ? `Apollo (${payload.mode}${
              payload.verifyMode !== "skipped"
                ? ` · verify ${payload.verifyMode}`
                : ""
            }) imported ${n} durable discover deal(s)${
              payload.deals[0]?.emailVerified ? " with verified email" : ""
            } — open pipeline to qualify.`
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
                data-testid="hunt-apollo-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Apollo search (mock without key)"
                aria-label="Prospecting query"
              />
              <button
                type="button"
                data-testid="hunt-apollo-prospect"
                className="rounded-full border border-sand bg-white px-4 py-2 text-sm disabled:opacity-40"
                disabled={apolloImport.isPending || query.trim().length < 2}
                onClick={() => {
                  setResult(null);
                  apolloImport.mutate({ query: query.trim() });
                }}
              >
                {apolloImport.isPending ? "Searching…" : "Prospect with Apollo"}
              </button>
              {lastApolloDealId ? (
                <Link
                  className="text-sm underline"
                  data-testid="hunt-apollo-open-deal"
                  href={`/crm/deals/${lastApolloDealId}`}
                >
                  Open deal
                </Link>
              ) : null}
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
              <button
                type="button"
                data-testid="hunt-closed-loop-apollo"
                className="rounded-full border border-sand bg-white px-4 py-2 text-sm disabled:opacity-40"
                disabled={demo.isPending}
                onClick={() => {
                  setResult(null);
                  demo.mutate({
                    viaApollo: true,
                    companyName: query.trim() || undefined,
                  });
                }}
              >
                {demo.isPending
                  ? "Running…"
                  : "Closed loop via Apollo"}
              </button>
              {demo.data && demo.data.ok ? (
                <>
                  <Link
                    className="text-sm underline"
                    data-testid="hunt-next-deal"
                    href={demo.data.next.crmDeal}
                  >
                    Deal
                  </Link>
                  <Link
                    className="text-sm underline"
                    data-testid="hunt-next-client"
                    href={demo.data.next.client}
                  >
                    Client
                  </Link>
                  {demo.data.next.account ? (
                    <Link
                      className="text-sm underline"
                      data-testid="hunt-next-account"
                      href={demo.data.next.account}
                    >
                      Account
                    </Link>
                  ) : null}
                  <Link
                    className="text-sm underline"
                    data-testid="hunt-next-creative"
                    href={demo.data.next.creative}
                  >
                    Creative
                  </Link>
                  {"approvals" in demo.data.next && demo.data.next.approvals ? (
                    <Link
                      className="text-sm underline"
                      data-testid="hunt-next-approvals"
                      href={demo.data.next.approvals}
                    >
                      Approvals
                    </Link>
                  ) : null}
                  {"outreach" in demo.data.next && demo.data.next.outreach ? (
                    <Link
                      className="text-sm underline"
                      data-testid="hunt-next-outreach"
                      href={demo.data.next.outreach}
                    >
                      Outreach
                    </Link>
                  ) : null}
                  {"finance" in demo.data.next && demo.data.next.finance ? (
                    <Link
                      className="text-sm underline"
                      data-testid="hunt-next-finance"
                      href={demo.data.next.finance}
                    >
                      Finance
                    </Link>
                  ) : null}
                  <Link
                    className="text-sm underline"
                    data-testid="hunt-next-portal"
                    href={demo.data.next.portal}
                  >
                    Portal
                  </Link>
                  <Link
                    className="text-sm underline"
                    data-testid="hunt-next-onboarding"
                    href={demo.data.next.onboarding}
                  >
                    Onboarding
                  </Link>
                </>
              ) : null}
              <Link className="text-sm underline" href="/crm">
                Pipeline
              </Link>
            </div>
            {toolReady ? (
              <div
                className="mt-3 space-y-2 text-xs text-muted"
                data-testid="hunt-ready-banner"
              >
                <p>
                  Tools: apollo {toolReady.apollo} · n8n {toolReady.n8n} · xero{" "}
                  {toolReady.xero} · composio{" "}
                  {toolReady.composio} · resend {toolReady.resend ?? "—"} ·
                  portal magic-link {ready?.portalMagicLink ?? "—"}
                  {" · "}
                  <Link
                    href="/settings/connections#conn-google_workspace"
                    className="underline"
                  >
                    Connections
                  </Link>
                </p>
                {ready ? (
                  <p data-testid="hunt-runtime-llm">
                    LLM {formatReadyLlmLine(ready)}
                  </p>
                ) : null}
                {ready?.connections ? (
                  <p>
                    Connected accounts: GW {ready.connections.googleWorkspace ?? 0}{" "}
                    · Canva {ready.connections.canva ?? 0} · LinkedIn{" "}
                    {ready.connections.linkedin ?? 0} · Xero{" "}
                    {ready.connections.xero ?? 0}
                  </p>
                ) : null}
                {orderedBlockers.length > 0 ? (
                  <ul
                    className="list-disc space-y-1 pl-4 text-ink/80"
                    data-testid="hunt-ready-blockers"
                  >
                    {orderedBlockers.map((item) => {
                      const href = demoBlockerConnectionsPath(item);
                      const anchor = href?.split("#")[1];
                      return (
                        <li key={item} data-testid="hunt-ready-blocker">
                          {href ? (
                            <Link
                              href={href}
                              className="underline"
                              data-testid={
                                anchor
                                  ? `hunt-blocker-link-${anchor.replace("conn-", "")}`
                                  : "hunt-blocker-link"
                              }
                            >
                              {item}
                            </Link>
                          ) : (
                            item
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-ink/80" data-testid="hunt-ready-clear">
                    Hunt is open. Connect Google Workspace when you want live
                    HITL Gmail. Apollo, Xero, LinkedIn, Canva, and Resend can
                    wait.
                  </p>
                )}
              </div>
            ) : null}
            {result ? (
              <div
                className="mt-4 rounded-xl border border-ink/20 bg-white px-4 py-3 text-sm text-ink shadow-sm"
                role="status"
                aria-live="polite"
                data-testid="hunt-closed-loop-status"
              >
                <p className="font-medium">{result}</p>
                {demo.data && demo.data.ok ? (
                  <p className="mt-2 flex flex-wrap gap-3 text-sm">
                    <Link
                      className="underline"
                      data-testid="hunt-status-account"
                      href={
                        demo.data.next.account ??
                        `/account?clientId=${encodeURIComponent(demo.data.clientId)}`
                      }
                    >
                      Open Account calendar →
                    </Link>
                    <Link
                      className="underline"
                      data-testid="hunt-status-client"
                      href={demo.data.next.client}
                    >
                      Client onboarding
                    </Link>
                    <Link
                      className="underline"
                      data-testid="hunt-status-creative"
                      href={demo.data.next.creative}
                    >
                      Creative
                    </Link>
                    {"approvals" in demo.data.next &&
                    demo.data.next.approvals ? (
                      <Link
                        className="underline"
                        data-testid="hunt-status-approvals"
                        href={demo.data.next.approvals}
                      >
                        Approvals (HITL)
                      </Link>
                    ) : null}
                    {"outreach" in demo.data.next && demo.data.next.outreach ? (
                      <Link
                        className="underline"
                        data-testid="hunt-status-outreach"
                        href={demo.data.next.outreach}
                      >
                        Outreach draft
                      </Link>
                    ) : null}
                    {"finance" in demo.data.next && demo.data.next.finance ? (
                      <Link
                        className="underline"
                        data-testid="hunt-status-finance"
                        href={demo.data.next.finance}
                      >
                        First invoice
                      </Link>
                    ) : null}
                    {demo.data.portalInvite?.portalPath ? (
                      <Link
                        className="underline"
                        data-testid="hunt-status-portal"
                        href={demo.data.portalInvite.portalPath}
                      >
                        Portal approvals link (
                        {demo.data.portalInvite.delivery?.mode ?? "mock"})
                      </Link>
                    ) : null}
                    {demo.data.portalInvite?.onboardingPath ? (
                      <Link
                        className="underline"
                        data-testid="hunt-status-onboarding"
                        href={demo.data.portalInvite.onboardingPath}
                      >
                        Onboarding magic link
                      </Link>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted">
              Apollo imports write durable CRM deals (same store as pipeline).
              Keys in Connections go live; without keys Apollo stays mock.
              Closed loop seeds prospect → won → onboarding + creative task.
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
            <Link href="/crm/research">
              Research gates <span aria-hidden>↗</span>
            </Link>
            <Link href="/crm/tasks">
              Sales tasks <span aria-hidden>↗</span>
            </Link>
            <Link href="/crm/activities">
              Activities <span aria-hidden>↗</span>
            </Link>
            <Link href="/settings/connections">
              Connections <span aria-hidden>↗</span>
            </Link>
            <Link href="/crm/settings/sales-os">
              Sales OS <span aria-hidden>↗</span>
            </Link>
          </nav>
        </footer>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-16">
        <ResearchConsole />
      </div>
    </main>
  );
}
