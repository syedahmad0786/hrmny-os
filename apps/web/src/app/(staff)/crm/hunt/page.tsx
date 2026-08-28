"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  demoBlockerConnectionsPath,
  prioritizeDemoBlockers,
} from "@/lib/demo-blocker-anchor";
import { formatReadyLlmLine, type ReadySmoke } from "@/lib/ready-smoke";
import { ResearchConsole } from "../_components/research-console";

const LOOP = [
  {
    label: "Signal",
    href: "/crm/inbound",
    detail: "Find a real reason to talk",
  },
  { label: "Research", href: "/crm/research", detail: "Prove fit and timing" },
  {
    label: "Person",
    href: "/crm/contacts",
    detail: "Choose one decision-maker",
  },
  {
    label: "Outreach",
    href: "/crm/outreach",
    detail: "Approve a relevant draft",
  },
  { label: "Pipeline", href: "/crm", detail: "Move the next action" },
  {
    label: "Learn",
    href: "/crm/settings/sales-os",
    detail: "Review outcomes weekly",
  },
] as const;

type SearchCandidate = {
  externalId: string;
  fullName?: string;
  title?: string;
  email?: string;
  emailStatus?: string;
  companyName?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  source: string;
};

export default function HuntClientsPage() {
  const [result, setResult] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [query, setQuery] = useState("UAE retail marketing director");
  const [lastApolloDealId, setLastApolloDealId] = useState<string | null>(null);
  const [ready, setReady] = useState<ReadySmoke | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ready")
      .then((response) => response.json())
      .then((body: ReadySmoke) => {
        if (!cancelled) setReady(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const apolloStatus = trpc.salesOs.apollo.status.useQuery();
  const freeSearch = trpc.salesOs.apollo.search.useMutation({
    onSuccess: (payload) => {
      setSearchNote(
        payload.candidates.length
          ? `${payload.candidates.length} people found via Apollo ${payload.mode}. Search used 0 credits.`
          : `No people matched. Apollo ${payload.mode} search used 0 credits.`,
      );
    },
    onError: (error) => setSearchNote(error.message),
  });
  const enrichOne = trpc.salesOs.apollo.enrichOne.useMutation({
    onSuccess: (payload) => {
      setLastApolloDealId(payload.crm?.dealId ?? null);
      setSearchNote(
        payload.imported
          ? `Connection proven. ${payload.crm?.fullName ?? "One person"} was reconciled into ${payload.crm?.companyName ?? "CRM"}; ${payload.creditsRecorded} credit recorded.`
          : `${payload.reason ?? "Apollo returned no match."} ${payload.creditsRecorded} credit recorded.`,
      );
      void utils.salesOs.apollo.status.invalidate();
      void utils.crm.deals.list.invalidate();
      void utils.crm.companies.list.invalidate();
      void utils.crm.contacts.list.invalidate();
    },
    onError: (error) => setSearchNote(error.message),
  });

  const toolReady = ready?.tools ?? null;
  const orderedBlockers = prioritizeDemoBlockers(ready?.blockers ?? []);
  const apolloConnected = toolReady?.apollo === "configured";
  const canaryResult = apolloStatus.data?.result as
    | {
        mode?: "mock" | "live";
        crm?: { dealId?: string; fullName?: string; companyName?: string };
      }
    | undefined;
  const canaryDealId = canaryResult?.crm?.dealId;
  const apolloProviderAccepted =
    freeSearch.data?.mode === "live" ||
    (apolloStatus.data?.status === "completed" &&
      canaryResult?.mode === "live");
  const canaryLabel = useMemo(() => {
    if (apolloStatus.isLoading) return "Checking one-person allowance…";
    if (apolloStatus.data?.available)
      return "One approved enrichment available";
    if (apolloStatus.data?.status === "completed")
      return "One-person proof completed";
    return `Enrichment locked · ${apolloStatus.data?.status ?? "unavailable"}`;
  }, [apolloStatus.data, apolloStatus.isLoading]);

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
    onError: (error) => setResult(error.message),
  });
  const apolloImport = trpc.crm.prospect.apolloImport.useMutation({
    onSuccess: (payload) => {
      const count = payload.deals.length;
      const first = payload.deals[0];
      setLastApolloDealId(first?.dealId ?? null);
      setResult(
        count > 0
          ? `Apollo (${payload.mode}${
              payload.verifyMode !== "skipped"
                ? ` · verify ${payload.verifyMode}`
                : ""
            }) imported ${count} durable discover deal(s)${
              first?.emailVerified ? " with verified email" : ""
            } — open pipeline to qualify.`
          : "Apollo returned no companies for that query.",
      );
      void utils.crm.deals.list.invalidate();
    },
    onError: (error) => setResult(error.message),
  });

  function approveOne(candidate: SearchCandidate) {
    const label = `${candidate.fullName ?? "this person"} at ${
      candidate.companyName ?? "their company"
    }`;
    if (
      !window.confirm(
        `Use the single approved Apollo enrichment for ${label}? This can use 1 credit. Phone, personal-email, and waterfall enrichment stay off.`,
      )
    ) {
      return;
    }
    enrichOne.mutate({
      candidate: {
        externalId: candidate.externalId,
        email: candidate.email,
        fullName: candidate.fullName,
        companyName: candidate.companyName,
        companyDomain: candidate.companyDomain,
        linkedinUrl: candidate.linkedinUrl,
      },
      confirmCreditUse: true,
    });
  }

  return (
    <main className="growth-page" data-testid="sales-growth-page">
      <header className="growth-header">
        <div>
          <p className="growth-kicker">Sales Growth</p>
          <h1>Find the next right client.</h1>
          <p>
            One clear loop from a market signal to a qualified conversation.
            Every message and paid lookup stays human-approved.
          </p>
        </div>
        <div className="growth-header-actions">
          <Link href="/crm" className="growth-primary-link">
            Open pipeline <span aria-hidden>→</span>
          </Link>
          <Link href="/crm/settings/sales-os" className="growth-text-link">
            Growth settings
          </Link>
        </div>
      </header>

      <nav className="growth-loop" aria-label="Sales Growth operating loop">
        {LOOP.map((step, index) => (
          <Link
            key={step.label}
            href={step.href}
            className={index === 0 ? "is-next" : undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </Link>
        ))}
      </nav>

      <section className="growth-command-grid">
        <div className="growth-panel growth-search-panel">
          <div className="growth-panel-heading">
            <div>
              <p className="growth-kicker">Next action</p>
              <h2>Search decision-makers</h2>
            </div>
            <span className="growth-cost-badge">0 credits</span>
          </div>
          <p className="growth-panel-copy">
            Apollo People Search is read-only and free. Review the people first;
            the separate one-person button is the only paid action enabled.
          </p>
          <form
            className="growth-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSearchNote(null);
              freeSearch.mutate({ query: query.trim(), perPage: 8 });
            }}
          >
            <label htmlFor="apollo-query">Role, market, or company</label>
            <div>
              <input
                id="apollo-query"
                data-testid="hunt-apollo-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. UAE hospitality marketing director"
                minLength={2}
              />
              <button
                type="submit"
                data-testid="hunt-apollo-search"
                disabled={freeSearch.isPending || query.trim().length < 2}
              >
                {freeSearch.isPending
                  ? "Searching…"
                  : "Search Apollo · 0 credits"}
              </button>
            </div>
          </form>

          {searchNote ? (
            <p
              className="growth-status"
              role="status"
              aria-live="polite"
              data-testid="hunt-apollo-search-status"
            >
              {searchNote}
              {lastApolloDealId ? (
                <Link href={`/crm/deals/${lastApolloDealId}`}>
                  Open CRM deal →
                </Link>
              ) : null}
            </p>
          ) : null}

          {(freeSearch.data?.candidates ?? []).length > 0 ? (
            <ol className="growth-candidates" data-testid="hunt-apollo-results">
              {(freeSearch.data?.candidates ?? []).map((candidate) => (
                <li key={candidate.externalId}>
                  <div>
                    <strong>
                      {candidate.fullName ?? "Named person unavailable"}
                    </strong>
                    <span>
                      {[candidate.title, candidate.companyName]
                        .filter(Boolean)
                        .join(" · ") || "Professional profile"}
                    </span>
                    <small>
                      {candidate.companyDomain ?? "Domain unavailable"} · email
                      not unlocked by search
                    </small>
                  </div>
                  <div className="growth-candidate-actions">
                    {candidate.linkedinUrl ? (
                      <a
                        href={candidate.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Profile
                      </a>
                    ) : null}
                    <button
                      type="button"
                      data-testid="hunt-apollo-enrich-one"
                      disabled={
                        enrichOne.isPending || !apolloStatus.data?.available
                      }
                      onClick={() => approveOne(candidate)}
                    >
                      {enrichOne.isPending
                        ? "Enriching…"
                        : "Use 1 approved credit"}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        <aside className="growth-panel growth-connection-panel">
          <div className="growth-panel-heading">
            <div>
              <p className="growth-kicker">Connection proof</p>
              <h2>Apollo guardrails</h2>
            </div>
            <span
              className={`growth-dot${apolloProviderAccepted ? " is-live" : ""}`}
              aria-label={
                apolloProviderAccepted
                  ? "Apollo provider accepted"
                  : "Apollo provider acceptance pending"
              }
            />
          </div>
          <dl className="growth-guardrails">
            <div>
              <dt>Credential</dt>
              <dd>
                {apolloConnected ? "Reference present" : "Not configured"}
              </dd>
            </div>
            <div>
              <dt>People Search</dt>
              <dd>
                {apolloProviderAccepted
                  ? "Provider accepted · 0 credits"
                  : apolloConnected
                    ? "Ready to verify · 0 credits"
                    : "Unavailable · 0 credits"}
              </dd>
            </div>
            <div>
              <dt>People Match</dt>
              <dd>{canaryLabel}</dd>
            </div>
            <div>
              <dt>Paid fields</dt>
              <dd>Phone, personal email, waterfalls off</dd>
            </div>
            <div>
              <dt>Outbound</dt>
              <dd>Draft only · no automatic send</dd>
            </div>
          </dl>
          {canaryDealId ? (
            <Link
              className="growth-primary-link"
              href={`/crm/deals/${canaryDealId}`}
            >
              View reconciled lead →
            </Link>
          ) : null}

          {toolReady ? (
            <div className="growth-runtime" data-testid="hunt-ready-banner">
              <p data-testid="hunt-runtime-llm">
                LLM {formatReadyLlmLine(ready!)}
              </p>
              {orderedBlockers.length ? (
                <ul data-testid="hunt-ready-blockers">
                  {orderedBlockers.map((item) => {
                    const href = demoBlockerConnectionsPath(item);
                    return (
                      <li key={item} data-testid="hunt-ready-blocker">
                        {href ? <Link href={href}>{item}</Link> : item}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p data-testid="hunt-ready-clear">
                  Core Sales Growth path is available. Optional send providers
                  remain approval-gated.
                </p>
              )}
            </div>
          ) : null}
        </aside>
      </section>

      <ResearchConsole />

      {ready?.authMode === "dev" ? (
        <details className="growth-test-tools">
          <summary data-testid="hunt-test-tools">
            Test tools <span>Creates clearly labeled synthetic records</span>
          </summary>
          <div className="growth-test-tools-body">
            <p>
              These controls support local/acceptance testing. They are
              collapsed so the client workflow stays focused.
            </p>
            <div className="growth-test-actions">
              <button
                type="button"
                data-testid="hunt-apollo-prospect"
                disabled={apolloImport.isPending || query.trim().length < 2}
                onClick={() => {
                  setResult(null);
                  apolloImport.mutate({ query: query.trim() });
                }}
              >
                {apolloImport.isPending
                  ? "Importing…"
                  : "Create mock Apollo deal"}
              </button>
              <button
                type="button"
                disabled={demo.isPending}
                onClick={() => {
                  setResult(null);
                  demo.mutate({});
                }}
              >
                {demo.isPending ? "Running…" : "Run demo closed loop"}
              </button>
              <button
                type="button"
                data-testid="hunt-closed-loop-apollo"
                disabled={demo.isPending}
                onClick={() => {
                  setResult(null);
                  demo.mutate({
                    viaApollo: true,
                    companyName: query.trim() || undefined,
                  });
                }}
              >
                {demo.isPending ? "Running…" : "Closed loop via Apollo"}
              </button>
              {lastApolloDealId ? (
                <Link
                  data-testid="hunt-apollo-open-deal"
                  href={`/crm/deals/${lastApolloDealId}`}
                >
                  Open deal
                </Link>
              ) : null}
            </div>

            {demo.data && demo.data.ok ? (
              <nav className="growth-test-links" aria-label="Demo result links">
                <Link
                  data-testid="hunt-next-deal"
                  href={demo.data.next.crmDeal}
                >
                  Deal
                </Link>
                <Link
                  data-testid="hunt-next-client"
                  href={demo.data.next.client}
                >
                  Client
                </Link>
                {demo.data.next.account ? (
                  <Link
                    data-testid="hunt-next-account"
                    href={demo.data.next.account}
                  >
                    Account
                  </Link>
                ) : null}
                <Link
                  data-testid="hunt-next-creative"
                  href={demo.data.next.creative}
                >
                  Creative
                </Link>
                {"approvals" in demo.data.next && demo.data.next.approvals ? (
                  <Link
                    data-testid="hunt-next-approvals"
                    href={demo.data.next.approvals}
                  >
                    Approvals
                  </Link>
                ) : null}
                {"outreach" in demo.data.next && demo.data.next.outreach ? (
                  <Link
                    data-testid="hunt-next-outreach"
                    href={demo.data.next.outreach}
                  >
                    Outreach
                  </Link>
                ) : null}
                {"finance" in demo.data.next && demo.data.next.finance ? (
                  <Link
                    data-testid="hunt-next-finance"
                    href={demo.data.next.finance}
                  >
                    Finance
                  </Link>
                ) : null}
                <Link
                  data-testid="hunt-next-portal"
                  href={demo.data.next.portal}
                >
                  Portal
                </Link>
                <Link
                  data-testid="hunt-next-onboarding"
                  href={demo.data.next.onboarding}
                >
                  Onboarding
                </Link>
              </nav>
            ) : null}

            {result ? (
              <div
                className="growth-status"
                role="status"
                aria-live="polite"
                data-testid="hunt-closed-loop-status"
              >
                <p>{result}</p>
                {demo.data && demo.data.ok ? (
                  <nav
                    className="growth-test-links"
                    aria-label="Demo status links"
                  >
                    <Link
                      data-testid="hunt-status-account"
                      href={
                        demo.data.next.account ??
                        `/account?clientId=${encodeURIComponent(demo.data.clientId)}`
                      }
                    >
                      Open Account calendar →
                    </Link>
                    <Link
                      data-testid="hunt-status-client"
                      href={demo.data.next.client}
                    >
                      Client onboarding
                    </Link>
                    <Link
                      data-testid="hunt-status-creative"
                      href={demo.data.next.creative}
                    >
                      Creative
                    </Link>
                    {"approvals" in demo.data.next &&
                    demo.data.next.approvals ? (
                      <Link
                        data-testid="hunt-status-approvals"
                        href={demo.data.next.approvals}
                      >
                        Approvals (HITL)
                      </Link>
                    ) : null}
                    {"outreach" in demo.data.next && demo.data.next.outreach ? (
                      <Link
                        data-testid="hunt-status-outreach"
                        href={demo.data.next.outreach}
                      >
                        Outreach draft
                      </Link>
                    ) : null}
                    {"finance" in demo.data.next && demo.data.next.finance ? (
                      <Link
                        data-testid="hunt-status-finance"
                        href={demo.data.next.finance}
                      >
                        First invoice
                      </Link>
                    ) : null}
                    {demo.data.portalInvite?.portalPath ? (
                      <Link
                        data-testid="hunt-status-portal"
                        href={demo.data.portalInvite.portalPath}
                      >
                        Portal approvals link (
                        {demo.data.portalInvite.delivery?.mode ?? "mock"})
                      </Link>
                    ) : null}
                    {demo.data.portalInvite?.onboardingPath ? (
                      <Link
                        data-testid="hunt-status-onboarding"
                        href={demo.data.portalInvite.onboardingPath}
                      >
                        Onboarding magic link
                      </Link>
                    ) : null}
                  </nav>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </main>
  );
}
