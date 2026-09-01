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
  companyName?: string;
  companyDomain?: string;
  source: string;
};

type SearchBridgeResult = {
  receiptId: string;
  mode: "mock" | "live";
  status:
    "processing" | "retry_scheduled" | "completed" | "dead_letter" | "revoked";
  attempts: number;
  candidates: SearchCandidate[];
  nextAttemptAt?: string;
  queue?: "inngest" | "scheduled_job_fallback" | "injected_test_queue";
  reason?: string;
};

type PendingApolloSearch = {
  idempotencyKey: string;
  query?: string;
  titles: string[];
  perPage: number;
};

const EMPTY_REQUEST_ID = "00000000-0000-4000-8000-000000000000";
const APOLLO_SEARCH_SESSION_KEY = "hrmny.apollo-search.pending.v1";

function samePendingSearch(
  left: PendingApolloSearch,
  right: Omit<PendingApolloSearch, "idempotencyKey">,
) {
  return (
    left.query === right.query &&
    left.perPage === right.perPage &&
    left.titles.join("\n") === right.titles.join("\n")
  );
}

export default function HuntClientsPage() {
  const [result, setResult] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [title, setTitle] = useState("Marketing Director");
  const [query, setQuery] = useState("");
  const [syntheticCompany, setSyntheticCompany] = useState("");
  const [apolloSearchRequestId, setApolloSearchRequestId] = useState<
    string | null
  >(null);
  const [pendingApolloSearch, setPendingApolloSearch] =
    useState<PendingApolloSearch | null>(null);
  const [apolloSearchResult, setApolloSearchResult] =
    useState<SearchBridgeResult | null>(null);
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

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(APOLLO_SEARCH_SESSION_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw) as Partial<PendingApolloSearch>;
      if (
        typeof pending.idempotencyKey !== "string" ||
        !Array.isArray(pending.titles) ||
        !pending.titles.every((item) => typeof item === "string") ||
        typeof pending.perPage !== "number"
      ) {
        window.sessionStorage.removeItem(APOLLO_SEARCH_SESSION_KEY);
        return;
      }
      const restored = pending as PendingApolloSearch;
      setPendingApolloSearch(restored);
      setApolloSearchRequestId(restored.idempotencyKey);
      setTitle(restored.titles[0] ?? "Marketing Director");
      setQuery(restored.query ?? "");
      setSearchNote(
        "Restored the pending Apollo receipt; checking its status.",
      );
    } catch {
      window.sessionStorage.removeItem(APOLLO_SEARCH_SESSION_KEY);
    }
  }, []);

  function rememberPendingSearch(pending: PendingApolloSearch) {
    setPendingApolloSearch(pending);
    setApolloSearchRequestId(pending.idempotencyKey);
    window.sessionStorage.setItem(
      APOLLO_SEARCH_SESSION_KEY,
      JSON.stringify(pending),
    );
  }

  function forgetPendingSearch() {
    setPendingApolloSearch(null);
    setApolloSearchRequestId(null);
    window.sessionStorage.removeItem(APOLLO_SEARCH_SESSION_KEY);
  }

  const salesAccess = trpc.salesOs.access.useQuery();
  const apolloStatus = trpc.salesOs.apollo.status.useQuery();
  const apolloConnection = trpc.salesOs.apollo.connection.useQuery();
  const freeSearch = trpc.salesOs.apollo.search.useMutation({
    onSuccess: (payload) => {
      setApolloSearchResult(payload);
      setSearchNote(
        payload.status === "retry_scheduled" || payload.status === "processing"
          ? payload.reason === "APOLLO_SEARCH_QUEUED"
            ? payload.queue === "scheduled_job_fallback"
              ? `Apollo search retained in the durable fallback queue; managed queue activation is still pending. Receipt ${payload.receiptId.slice(0, 8)}. No credits used.`
              : `Apollo search queued for durable execution; receipt ${payload.receiptId.slice(0, 8)}. No credits used.`
            : `Apollo is temporarily unavailable. Durable retry scheduled; receipt ${payload.receiptId.slice(0, 8)}. No credits used.`
          : payload.candidates.length
            ? `${payload.candidates.length} people found via Apollo ${payload.mode}. Receipt ${payload.receiptId.slice(0, 8)} reconciled; 0 credits used.`
            : `No people matched. Apollo ${payload.mode} receipt ${payload.receiptId.slice(0, 8)} reconciled; 0 credits used.`,
      );
      if (
        payload.status !== "retry_scheduled" &&
        payload.status !== "processing"
      ) {
        forgetPendingSearch();
      }
    },
    onError: (error) => {
      setSearchNote(
        `${error.message}. Outcome not confirmed; checking the same durable request before any retry.`,
      );
    },
  });
  const searchReceipt = trpc.salesOs.apollo.searchStatus.useQuery(
    { idempotencyKey: apolloSearchRequestId ?? EMPTY_REQUEST_ID },
    {
      enabled: Boolean(apolloSearchRequestId),
      refetchInterval: 3_000,
    },
  );
  const missingApolloReceipt =
    Boolean(pendingApolloSearch) &&
    searchReceipt.isSuccess &&
    searchReceipt.data === null;
  const cancelSearch = trpc.salesOs.apollo.cancelSearch.useMutation({
    onSuccess: (payload) => {
      setApolloSearchResult(payload);
      setSearchNote(
        `Apollo search cancelled. Receipt ${payload.receiptId.slice(0, 8)} retained for review; 0 credits used.`,
      );
      forgetPendingSearch();
    },
    onError: (error) => setSearchNote(error.message),
  });

  useEffect(() => {
    const payload = searchReceipt.data;
    if (
      searchReceipt.isSuccess &&
      payload === null &&
      pendingApolloSearch
    ) {
      setApolloSearchResult(null);
      setSearchNote(
        "No server receipt exists for this request. Retry the same request ID; no new provider action has been authorized.",
      );
      return;
    }
    if (!payload) return;
    setApolloSearchResult(payload);
    if (payload.status === "retry_scheduled") {
      setSearchNote(
        payload.reason === "APOLLO_SEARCH_QUEUED"
          ? payload.queue === "scheduled_job_fallback"
            ? `Apollo search is retained in the fallback queue; managed queue activation is still pending. Receipt ${payload.receiptId.slice(0, 8)}. No credits used.`
            : `Apollo search is queued; receipt ${payload.receiptId.slice(0, 8)}. No credits used.`
          : `Apollo retry is scheduled for ${payload.nextAttemptAt ?? "the provider-safe window"}. Receipt ${payload.receiptId.slice(0, 8)}. No credits used.`,
      );
    } else if (payload.status === "processing") {
      setSearchNote(
        `Apollo is processing the same durable request. Receipt ${payload.receiptId.slice(0, 8)}. No credits used.`,
      );
    } else if (payload.status === "completed") {
      setSearchNote(
        `${payload.candidates.length} Apollo people reconciled from receipt ${payload.receiptId.slice(0, 8)} after ${payload.attempts} attempt${payload.attempts === 1 ? "" : "s"}; 0 credits used.`,
      );
      forgetPendingSearch();
    } else if (
      payload.status === "dead_letter" ||
      payload.status === "revoked"
    ) {
      setSearchNote(
        `Apollo search ${payload.status.replace("_", " ")}. Receipt ${payload.receiptId.slice(0, 8)} retained for review; 0 credits used.`,
      );
      forgetPendingSearch();
    }
  }, [pendingApolloSearch, searchReceipt.data, searchReceipt.isSuccess]);
  const toolReady = ready?.tools ?? null;
  const orderedBlockers = prioritizeDemoBlockers(ready?.blockers ?? []);
  const apolloConnected = apolloConnection.data?.configured === true;
  const canaryResult = apolloStatus.data?.result as
    | {
        mode?: "mock" | "live";
        crm?: { dealId?: string; fullName?: string; companyName?: string };
      }
    | undefined;
  const canaryDealId = canaryResult?.crm?.dealId;
  const apolloProviderVerified =
    apolloSearchResult?.mode === "live" &&
    apolloSearchResult.status === "completed";
  const canaryLabel =
    apolloStatus.data?.status === "completed" && canaryResult?.mode === "live"
      ? "Locked · historical receipt retained"
      : "Locked · exact approval receipt required";

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
      if ("skipped" in payload) {
        setLastApolloDealId(null);
        setResult(
          "Legacy bulk import is disabled. Use the reviewed free search and exact-person confirmation above.",
        );
        return;
      }
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
        <div
          id="apollo-people-search"
          className="growth-panel growth-search-panel"
        >
          <div className="growth-panel-heading">
            <div>
              <p className="growth-kicker">Next action</p>
              <h2>Search decision-makers</h2>
            </div>
            <span className="growth-cost-badge">0 credits</span>
          </div>
          <p className="growth-panel-copy">
            Connected Apollo People Search is read-only and free. Synthetic
            people stay hidden. Paid People Match remains locked until an exact
            candidate has a fresh server-side approval receipt.
          </p>
          {salesAccess.data && !salesAccess.data.canOperate ? (
            <p className="growth-status" role="status">
              View only. A Sales operator must run provider searches or paid
              enrichment.
            </p>
          ) : null}
          <form
            className="growth-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSearchNote(null);
              setApolloSearchResult(null);
              const request = {
                titles: [title.trim()],
                query: query.trim() || undefined,
                perPage: 8,
              };
              const idempotencyKey =
                pendingApolloSearch &&
                samePendingSearch(pendingApolloSearch, request)
                  ? pendingApolloSearch.idempotencyKey
                  : crypto.randomUUID();
              rememberPendingSearch({ idempotencyKey, ...request });
              freeSearch.mutate({ idempotencyKey, ...request });
            }}
          >
            <div className="growth-search-fields">
              <label htmlFor="apollo-title">
                Job title
                <input
                  id="apollo-title"
                  data-testid="hunt-apollo-title"
                  disabled={
                    !salesAccess.data?.canOperate ||
                    !apolloConnected ||
                    Boolean(pendingApolloSearch)
                  }
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Marketing Director"
                  minLength={2}
                />
              </label>
              <label htmlFor="apollo-query">
                Company or industry keyword <span>optional</span>
                <input
                  id="apollo-query"
                  data-testid="hunt-apollo-query"
                  disabled={
                    !salesAccess.data?.canOperate ||
                    !apolloConnected ||
                    Boolean(pendingApolloSearch)
                  }
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="e.g. hospitality"
                />
              </label>
            </div>
            <div className="growth-search-actions">
              <p>
                Market <strong>United Arab Emirates</strong>
              </p>
              <button
                type="submit"
                data-testid="hunt-apollo-search"
                disabled={
                  !salesAccess.data?.canOperate ||
                  !apolloConnected ||
                  freeSearch.isPending ||
                  Boolean(pendingApolloSearch) ||
                  title.trim().length < 2
                }
              >
                {freeSearch.isPending
                  ? "Searching…"
                  : !apolloConnected
                    ? "Connect Apollo to search"
                    : "Search Apollo · 0 credits"}
              </button>
              {pendingApolloSearch ? (
                missingApolloReceipt ? (
                  <button
                    type="button"
                    data-testid="hunt-apollo-retry-same-search"
                    data-request-id={pendingApolloSearch.idempotencyKey}
                    disabled={
                      !salesAccess.data?.canOperate ||
                      !apolloConnected ||
                      freeSearch.isPending
                    }
                    onClick={() => freeSearch.mutate(pendingApolloSearch)}
                  >
                    {freeSearch.isPending
                      ? "Retrying same request…"
                      : "Retry same request"}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="hunt-apollo-cancel-search"
                    disabled={cancelSearch.isPending}
                    onClick={() =>
                      cancelSearch.mutate({
                        idempotencyKey: pendingApolloSearch.idempotencyKey,
                      })
                    }
                  >
                    {cancelSearch.isPending
                      ? "Cancelling…"
                      : "Cancel search"}
                  </button>
                )
              ) : null}
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

          {(apolloSearchResult?.candidates ?? []).length > 0 ? (
            <ol className="growth-candidates" data-testid="hunt-apollo-results">
              {(apolloSearchResult?.candidates ?? []).map((candidate) => (
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
                    <span data-testid="hunt-apollo-enrichment-locked">
                      Paid enrichment locked
                    </span>
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
              className={`growth-dot${apolloProviderVerified ? " is-live" : ""}`}
              aria-label={
                apolloProviderVerified
                  ? "Apollo response verified"
                  : "Apollo response verification pending"
              }
            />
          </div>
          <dl className="growth-guardrails">
            <div>
              <dt>Credential</dt>
              <dd data-testid="hunt-apollo-credential">
                {apolloConnected ? "Reference present" : "Not configured"}
              </dd>
            </div>
            <div>
              <dt>People Search</dt>
              <dd>
                {apolloProviderVerified
                  ? "Response verified · 0 credits"
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

      {ready?.syntheticSalesFixtures ? (
        <details className="growth-test-tools">
          <summary data-testid="hunt-test-tools">
            Test tools <span>Creates clearly labeled synthetic records</span>
          </summary>
          <div className="growth-test-tools-body">
            <p>
              These controls support local/acceptance testing. They are
              collapsed so the client workflow stays focused.
            </p>
            <label className="growth-test-input" htmlFor="synthetic-company">
              Synthetic company label
              <input
                id="synthetic-company"
                data-testid="hunt-synthetic-company"
                value={syntheticCompany}
                onChange={(event) => setSyntheticCompany(event.target.value)}
                placeholder="e.g. E2E Northstar 001"
                minLength={2}
              />
            </label>
            <div className="growth-test-actions">
              <button
                type="button"
                data-testid="hunt-apollo-prospect"
                disabled={
                  apolloImport.isPending || syntheticCompany.trim().length < 2
                }
                onClick={() => {
                  setResult(null);
                  apolloImport.mutate({ query: syntheticCompany.trim() });
                }}
              >
                {apolloImport.isPending
                  ? "Importing…"
                  : "Create synthetic Apollo fixture"}
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
                disabled={demo.isPending || syntheticCompany.trim().length < 2}
                onClick={() => {
                  setResult(null);
                  demo.mutate({
                    viaApollo: true,
                    companyName: syntheticCompany.trim(),
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
