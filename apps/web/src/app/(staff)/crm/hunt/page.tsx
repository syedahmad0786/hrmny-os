"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  demoBlockerConnectionsPath,
  prioritizeDemoBlockers,
} from "@/lib/demo-blocker-anchor";
import {
  clearPendingApolloSearch,
  isCurrentApolloSearchOperation,
  persistPendingApolloSearch,
  restorePendingApolloSearch,
  type ActiveApolloSearch,
  type PendingApolloSearch,
} from "@/lib/apollo-search-session";
import { formatReadyLlmLine, type ReadySmoke } from "@/lib/ready-smoke";
import {
  apolloCancellationNote,
  apolloSearchStatusNote,
} from "./apollo-status-copy";

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
  providerAttemptedPreviously?: boolean;
  providerMaySettle?: boolean;
};

type SavedCandidate = {
  externalId: string;
  dealId: string;
  companyName: string;
  fullName?: string | null;
  email?: string | null;
  emailVerified?: boolean;
};

function searchStatusNote(payload: SearchBridgeResult): string {
  return apolloSearchStatusNote({
    ...payload,
    candidateCount: payload.candidates.length,
  });
}

type PrincipalOperation = {
  principalId: string | null;
  operationId: string;
};

function operationBelongsToPrincipal(
  operation: PrincipalOperation | null,
  principalId: string | null,
) {
  return Boolean(
    operation && principalId && operation.principalId === principalId,
  );
}

const EMPTY_REQUEST_ID = "00000000-0000-4000-8000-000000000000";
const SERVER_RESTORE_NOTE = "Restored your latest Apollo search from HRMNY.";

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

const APOLLO_CREDIT_LABELS: Record<string, string> = {
  lead_credit: "Email / lead credits",
  direct_dial_credit: "Direct dial credits",
  export_credit: "Export credits",
  conversation_credit: "Conversation credits",
  ai_credit: "Apollo AI credits",
  power_up_credit: "Power-up credits",
  inbound_website_visitor_credit: "Website visitor credits",
  contact_website_visitor_credit: "Contact visitor credits",
  web_search_record_credit: "Web research credits",
  dialer: "Dialer minutes",
};

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
  const [recentlySaved, setRecentlySaved] = useState<
    Record<string, SavedCandidate>
  >({});
  const [creditReviewId, setCreditReviewId] = useState<string | null>(null);
  const [uiPrincipalId, setUiPrincipalId] = useState<string | null>(null);
  const [demoResultPrincipalId, setDemoResultPrincipalId] = useState<
    string | null
  >(null);
  const [freeSearchOperation, setFreeSearchOperation] =
    useState<PrincipalOperation | null>(null);
  const [cancelSearchOperation, setCancelSearchOperation] =
    useState<PrincipalOperation | null>(null);
  const [apolloImportOperation, setApolloImportOperation] =
    useState<PrincipalOperation | null>(null);
  const [demoOperation, setDemoOperation] = useState<PrincipalOperation | null>(
    null,
  );
  const [ready, setReady] = useState<ReadySmoke | null>(null);
  const utils = trpc.useUtils();
  const salesAccess = trpc.salesOs.access.useQuery();
  const session = trpc.auth.session.useQuery();
  const staffPrincipalId =
    session.data?.actorType === "staff" ? session.data.employeeId : null;
  const verifiedStaffPrincipalId =
    session.isSuccess && !session.isFetching ? staffPrincipalId : null;
  const activePrincipalIdRef = useRef<string | null>(verifiedStaffPrincipalId);
  const activeApolloSearchRef = useRef<ActiveApolloSearch | null>(null);
  const serverRestorePrincipalRef = useRef<string | null>(null);
  activePrincipalIdRef.current = verifiedStaffPrincipalId;
  const isUiPrincipalCurrent = Boolean(
    verifiedStaffPrincipalId && uiPrincipalId === verifiedStaffPrincipalId,
  );

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
    activeApolloSearchRef.current = null;
    serverRestorePrincipalRef.current = null;
    setResult(null);
    setSearchNote(null);
    setTitle("Marketing Director");
    setQuery("");
    setSyntheticCompany("");
    setPendingApolloSearch(null);
    setApolloSearchRequestId(null);
    setApolloSearchResult(null);
    setLastApolloDealId(null);
    setRecentlySaved({});
    setCreditReviewId(null);
    setDemoResultPrincipalId(null);
    setFreeSearchOperation(null);
    setCancelSearchOperation(null);
    setApolloImportOperation(null);
    setDemoOperation(null);
    setUiPrincipalId(staffPrincipalId);
    const principalId = staffPrincipalId;
    if (!principalId) return;
    void utils.salesOs.access.invalidate();
    void utils.salesOs.apollo.connection.invalidate();
    const restored = restorePendingApolloSearch(
      window.sessionStorage,
      principalId,
    );
    if (restored) {
      serverRestorePrincipalRef.current = principalId;
      activeApolloSearchRef.current = {
        principalId,
        idempotencyKey: restored.idempotencyKey,
      };
      setPendingApolloSearch(restored);
      setApolloSearchRequestId(restored.idempotencyKey);
      setTitle(restored.titles[0] ?? "Marketing Director");
      setQuery(restored.query ?? "");
      setSearchNote(
        "Restored the pending Apollo receipt; checking its status.",
      );
    }
  }, [staffPrincipalId, utils]);

  function rememberPendingSearch(pending: PendingApolloSearch) {
    const principalId = activePrincipalIdRef.current;
    if (!principalId) return false;
    if (
      !persistPendingApolloSearch(window.sessionStorage, principalId, pending)
    ) {
      return false;
    }
    activeApolloSearchRef.current = {
      principalId,
      idempotencyKey: pending.idempotencyKey,
    };
    setPendingApolloSearch(pending);
    setApolloSearchRequestId(pending.idempotencyKey);
    return true;
  }

  const forgetPendingSearch = useCallback((expectedIdempotencyKey: string) => {
    const principalId = activePrincipalIdRef.current;
    if (
      !isCurrentApolloSearchOperation(
        activeApolloSearchRef.current,
        principalId,
        expectedIdempotencyKey,
      )
    ) {
      return;
    }
    activeApolloSearchRef.current = null;
    setPendingApolloSearch(null);
    setApolloSearchRequestId(null);
    if (principalId) {
      clearPendingApolloSearch(
        window.sessionStorage,
        principalId,
        expectedIdempotencyKey,
      );
    }
  }, []);

  const apolloStatus = trpc.salesOs.apollo.status.useQuery();
  const apolloConnection = trpc.salesOs.apollo.connection.useQuery();
  const apolloCredits = trpc.salesOs.apollo.creditBalance.useQuery(undefined, {
    enabled: Boolean(verifiedStaffPrincipalId && isUiPrincipalCurrent),
    retry: false,
    staleTime: 30_000,
  });
  const latestApolloSearch = trpc.salesOs.apollo.latestSearch.useQuery(
    undefined,
    {
      enabled: Boolean(
        verifiedStaffPrincipalId &&
        isUiPrincipalCurrent &&
        !apolloSearchRequestId &&
        serverRestorePrincipalRef.current !== verifiedStaffPrincipalId,
      ),
      retry: false,
    },
  );
  useEffect(() => {
    const principalId = verifiedStaffPrincipalId;
    if (
      !principalId ||
      !isUiPrincipalCurrent ||
      serverRestorePrincipalRef.current === principalId ||
      !latestApolloSearch.isSuccess
    ) {
      return;
    }
    serverRestorePrincipalRef.current = principalId;
    const snapshot = latestApolloSearch.data;
    if (!snapshot || activeApolloSearchRef.current) return;
    activeApolloSearchRef.current = {
      principalId,
      idempotencyKey: snapshot.search.idempotencyKey,
    };
    setPendingApolloSearch(snapshot.search);
    setApolloSearchRequestId(snapshot.search.idempotencyKey);
    setTitle(snapshot.search.titles[0] ?? "Marketing Director");
    setQuery(snapshot.search.query ?? "");
    setApolloSearchResult(snapshot.result);
    setSearchNote(
      `${SERVER_RESTORE_NOTE} ${searchStatusNote(snapshot.result)}`,
    );
    persistPendingApolloSearch(
      window.sessionStorage,
      principalId,
      snapshot.search,
    );
  }, [
    isUiPrincipalCurrent,
    latestApolloSearch.data,
    latestApolloSearch.isSuccess,
    verifiedStaffPrincipalId,
  ]);
  const freeSearch = trpc.salesOs.apollo.search.useMutation({
    onMutate: () => {
      const operation = {
        principalId: activePrincipalIdRef.current,
        operationId: crypto.randomUUID(),
      };
      setFreeSearchOperation(operation);
      return operation;
    },
    onSuccess: (payload, variables, operation) => {
      if (
        operation?.principalId !== activePrincipalIdRef.current ||
        !isCurrentApolloSearchOperation(
          activeApolloSearchRef.current,
          activePrincipalIdRef.current,
          variables.idempotencyKey,
        )
      ) {
        return;
      }
      setApolloSearchResult(payload);
      setSearchNote(searchStatusNote(payload));
      if (payload.status === "dead_letter" || payload.status === "revoked") {
        forgetPendingSearch(variables.idempotencyKey);
      }
    },
    onError: (error, variables, operation) => {
      if (
        operation?.principalId !== activePrincipalIdRef.current ||
        !isCurrentApolloSearchOperation(
          activeApolloSearchRef.current,
          activePrincipalIdRef.current,
          variables.idempotencyKey,
        )
      ) {
        return;
      }
      setSearchNote(
        `${error.message}. Outcome not confirmed; checking the same durable request before any retry.`,
      );
    },
    onSettled: (_data, _error, _variables, operation) => {
      setFreeSearchOperation((current) =>
        current?.operationId === operation?.operationId ? null : current,
      );
    },
  });
  const freeSearchPending = operationBelongsToPrincipal(
    freeSearchOperation,
    verifiedStaffPrincipalId,
  );
  const hasCurrentApolloSearch = isCurrentApolloSearchOperation(
    activeApolloSearchRef.current,
    verifiedStaffPrincipalId,
    apolloSearchRequestId,
  );
  const searchReceipt = trpc.salesOs.apollo.searchStatus.useQuery(
    { idempotencyKey: apolloSearchRequestId ?? EMPTY_REQUEST_ID },
    {
      enabled: hasCurrentApolloSearch,
      refetchInterval:
        !apolloSearchResult ||
        apolloSearchResult.status === "processing" ||
        apolloSearchResult.status === "retry_scheduled"
          ? 3_000
          : false,
    },
  );
  const apolloSearchActive = Boolean(
    hasCurrentApolloSearch &&
    (!apolloSearchResult ||
      apolloSearchResult.status === "processing" ||
      apolloSearchResult.status === "retry_scheduled"),
  );
  const missingApolloReceipt =
    hasCurrentApolloSearch &&
    Boolean(pendingApolloSearch) &&
    searchReceipt.isSuccess &&
    searchReceipt.data === null;
  const cancelSearch = trpc.salesOs.apollo.cancelSearch.useMutation({
    onMutate: () => {
      const operation = {
        principalId: activePrincipalIdRef.current,
        operationId: crypto.randomUUID(),
      };
      setCancelSearchOperation(operation);
      return operation;
    },
    onSuccess: (payload, variables, operation) => {
      if (
        operation?.principalId !== activePrincipalIdRef.current ||
        !isCurrentApolloSearchOperation(
          activeApolloSearchRef.current,
          activePrincipalIdRef.current,
          variables.idempotencyKey,
        )
      ) {
        return;
      }
      setApolloSearchResult(payload);
      setSearchNote(apolloCancellationNote(payload));
      forgetPendingSearch(variables.idempotencyKey);
    },
    onError: (error, variables, operation) => {
      if (
        operation?.principalId === activePrincipalIdRef.current &&
        isCurrentApolloSearchOperation(
          activeApolloSearchRef.current,
          activePrincipalIdRef.current,
          variables.idempotencyKey,
        )
      ) {
        setSearchNote(error.message);
      }
    },
    onSettled: (_data, _error, _variables, operation) => {
      setCancelSearchOperation((current) =>
        current?.operationId === operation?.operationId ? null : current,
      );
    },
  });
  const cancelSearchPending = operationBelongsToPrincipal(
    cancelSearchOperation,
    verifiedStaffPrincipalId,
  );
  const candidateExternalIds = (apolloSearchResult?.candidates ?? []).map(
    (candidate) => candidate.externalId,
  );
  const persistedCandidates = trpc.salesOs.apollo.savedCandidates.useQuery(
    { externalIds: candidateExternalIds },
    {
      enabled: isUiPrincipalCurrent && candidateExternalIds.length > 0,
    },
  );
  const savedCandidateByExternalId = new Map(
    [...(persistedCandidates.data ?? []), ...Object.values(recentlySaved)].map(
      (candidate) => [candidate.externalId, candidate],
    ),
  );
  const saveCandidate = trpc.salesOs.apollo.saveCandidate.useMutation({
    onSuccess: (payload, variables) => {
      setRecentlySaved((current) => ({
        ...current,
        [variables.candidate.externalId]: {
          externalId: variables.candidate.externalId,
          dealId: payload.dealId,
          companyName: payload.companyName,
        },
      }));
      setLastApolloDealId(payload.dealId);
      setSearchNote(
        `${payload.companyName} is in the pipeline${
          payload.duplicate ? " (already saved)" : ""
        }. Paid contact details remain locked.`,
      );
      void utils.crm.deals.list.invalidate();
      void utils.salesOs.apollo.savedCandidates.invalidate();
    },
    onError: (error) => setSearchNote(error.message),
  });
  const enrichExact = trpc.salesOs.apollo.enrichOne.useMutation({
    onMutate: () => ({ principalId: activePrincipalIdRef.current }),
    onSuccess: (payload, variables, operation) => {
      if (operation?.principalId !== activePrincipalIdRef.current) return;
      if (payload.crm?.dealId) {
        setRecentlySaved((current) => ({
          ...current,
          [variables.candidate.externalId]: {
            externalId: variables.candidate.externalId,
            dealId: payload.crm!.dealId,
            companyName:
              payload.crm!.companyName ??
              variables.candidate.companyName ??
              "Unknown company",
            fullName: payload.crm!.fullName,
            email: payload.crm!.email,
            emailVerified: payload.crm!.emailVerified,
          },
        }));
      }
      setCreditReviewId(null);
      setLastApolloDealId(payload.crm?.dealId ?? null);
      setSearchNote(
        payload.duplicate
          ? "The existing exact-person result was restored. No new Apollo request was made."
          : payload.imported
            ? `${payload.crm?.fullName ?? "The person"} is in the pipeline with ${
                payload.crm?.emailVerified
                  ? "a verified work email"
                  : "the available work contact details"
              }. Apollo recorded ${payload.creditsRecorded} credit.`
            : `${payload.reason ?? "Apollo returned no usable match."} Up to one Apollo credit was recorded.`,
      );
      void utils.crm.deals.list.invalidate();
      void utils.salesOs.apollo.savedCandidates.invalidate();
      void apolloStatus.refetch();
      void apolloCredits.refetch();
    },
    onError: (error, _variables, operation) => {
      if (operation?.principalId === activePrincipalIdRef.current) {
        setCreditReviewId(null);
        setSearchNote(error.message);
      }
    },
  });
  const approveExact = trpc.salesOs.apollo.approveExact.useMutation({
    onMutate: () => ({ principalId: activePrincipalIdRef.current }),
    onSuccess: (approval, variables, operation) => {
      if (operation?.principalId !== activePrincipalIdRef.current) return;
      enrichExact.mutate({
        candidate: variables.candidate,
        confirmCreditUse: true,
        approvalReceiptId: approval.approvalReceiptId,
      });
    },
    onError: (error, _variables, operation) => {
      if (operation?.principalId === activePrincipalIdRef.current) {
        setCreditReviewId(null);
        setSearchNote(error.message);
      }
    },
  });

  useEffect(() => {
    if (!hasCurrentApolloSearch) return;
    const payload = searchReceipt.data;
    if (searchReceipt.isSuccess && payload === null && pendingApolloSearch) {
      setApolloSearchResult(null);
      setSearchNote(
        "No server receipt exists for this request. Retry the same request ID; no new provider action has been authorized.",
      );
      return;
    }
    if (!payload) return;
    setApolloSearchResult(payload);
    setSearchNote((current) =>
      current?.startsWith(SERVER_RESTORE_NOTE)
        ? `${SERVER_RESTORE_NOTE} ${searchStatusNote(payload)}`
        : searchStatusNote(payload),
    );
    if (payload.status === "dead_letter" || payload.status === "revoked") {
      forgetPendingSearch(apolloSearchRequestId!);
    }
  }, [
    apolloSearchRequestId,
    forgetPendingSearch,
    hasCurrentApolloSearch,
    pendingApolloSearch,
    searchReceipt.data,
    searchReceipt.isSuccess,
  ]);
  const toolReady = ready?.tools ?? null;
  const orderedBlockers = prioritizeDemoBlockers(ready?.blockers ?? []);
  const salesAccessReady =
    isUiPrincipalCurrent &&
    salesAccess.isSuccess &&
    !salesAccess.isFetching &&
    salesAccess.data.principalId === verifiedStaffPrincipalId;
  const apolloConnectionReady =
    isUiPrincipalCurrent &&
    apolloConnection.isSuccess &&
    !apolloConnection.isFetching &&
    apolloConnection.data.principalId === verifiedStaffPrincipalId;
  const apolloControlsReady = salesAccessReady && apolloConnectionReady;
  const canOperateApollo =
    apolloControlsReady && salesAccess.data.canOperate === true;
  const apolloConnected =
    apolloControlsReady && apolloConnection.data.configured === true;
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
  const paidDetailsLabel = !apolloControlsReady
    ? "Checking access"
    : !apolloConnected
      ? "Unavailable · connect Apollo"
      : !canOperateApollo
        ? "View only · Sales operator required"
        : "Ready · exact confirmation · up to 1 credit";
  const apolloCreditsReady =
    isUiPrincipalCurrent &&
    apolloCredits.isSuccess &&
    !apolloCredits.isFetching &&
    apolloCredits.data.principalId === verifiedStaffPrincipalId;
  const liveCredits =
    apolloCreditsReady && apolloCredits.data.state === "live"
      ? apolloCredits.data
      : null;
  const leadCredits = liveCredits?.credits.lead_credit;

  const demo = trpc.crm.runDemoClosedLoop.useMutation({
    onMutate: () => {
      const operation = {
        principalId: activePrincipalIdRef.current,
        operationId: crypto.randomUUID(),
      };
      setDemoOperation(operation);
      return operation;
    },
    onSuccess: (data, _variables, operation) => {
      if (operation?.principalId !== activePrincipalIdRef.current) return;
      setDemoResultPrincipalId(operation.principalId);
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
    onError: (error, _variables, operation) => {
      if (operation?.principalId === activePrincipalIdRef.current) {
        setResult(error.message);
      }
    },
    onSettled: (_data, _error, _variables, operation) => {
      setDemoOperation((current) =>
        current?.operationId === operation?.operationId ? null : current,
      );
    },
  });
  const apolloImport = trpc.crm.prospect.apolloImport.useMutation({
    onMutate: () => {
      const operation = {
        principalId: activePrincipalIdRef.current,
        operationId: crypto.randomUUID(),
      };
      setApolloImportOperation(operation);
      return operation;
    },
    onSuccess: (payload, _variables, operation) => {
      if (operation?.principalId !== activePrincipalIdRef.current) return;
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
    onError: (error, _variables, operation) => {
      if (operation?.principalId === activePrincipalIdRef.current) {
        setResult(error.message);
      }
    },
    onSettled: (_data, _error, _variables, operation) => {
      setApolloImportOperation((current) =>
        current?.operationId === operation?.operationId ? null : current,
      );
    },
  });
  const demoPending = operationBelongsToPrincipal(
    demoOperation,
    verifiedStaffPrincipalId,
  );
  const apolloImportPending = operationBelongsToPrincipal(
    apolloImportOperation,
    verifiedStaffPrincipalId,
  );

  return (
    <main className="growth-page" data-testid="sales-growth-page">
      <header className="growth-header">
        <div>
          <p className="growth-kicker">Find clients</p>
          <h1>Find the next right client.</h1>
          <p>
            Search Apollo for the right decision-maker, review the fit, then
            choose what enters outreach. Search is free; paid details and sends
            always need a separate approval.
          </p>
        </div>
        <div className="growth-header-actions">
          <Link href="/crm" className="growth-primary-link">
            Open pipeline <span aria-hidden>→</span>
          </Link>
          <Link href="/settings/connections" className="growth-text-link">
            Manage Apollo
          </Link>
        </div>
      </header>

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
            Search by role and company or industry. This step never unlocks an
            email address and uses no Apollo credits. Review a person before
            requesting any paid details.
          </p>
          {salesAccessReady && !salesAccess.data.canOperate ? (
            <p className="growth-status" role="status">
              View only. A Sales operator must run provider searches or paid
              enrichment.
            </p>
          ) : null}
          <form
            className="growth-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canOperateApollo || !apolloConnected) {
                setSearchNote(
                  "Current employee access and Apollo connection must be verified before a search can start. No search was sent.",
                );
                return;
              }
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
              if (!rememberPendingSearch({ idempotencyKey, ...request })) {
                setSearchNote(
                  "Verified staff identity and durable browser receipt storage are required before a search can start. No search was sent.",
                );
                return;
              }
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
                    !canOperateApollo || !apolloConnected || apolloSearchActive
                  }
                  value={isUiPrincipalCurrent ? title : "Marketing Director"}
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
                    !canOperateApollo || !apolloConnected || apolloSearchActive
                  }
                  value={isUiPrincipalCurrent ? query : ""}
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
                  !canOperateApollo ||
                  !apolloConnected ||
                  freeSearchPending ||
                  apolloSearchActive ||
                  title.trim().length < 2
                }
              >
                {freeSearchPending
                  ? "Searching…"
                  : !apolloControlsReady
                    ? "Checking employee connection…"
                    : !apolloConnected
                      ? "Connect Apollo to search"
                      : "Search Apollo · 0 credits"}
              </button>
              {pendingApolloSearch && apolloSearchActive ? (
                missingApolloReceipt ? (
                  <button
                    type="button"
                    data-testid="hunt-apollo-retry-same-search"
                    data-request-id={pendingApolloSearch.idempotencyKey}
                    disabled={
                      !canOperateApollo || !apolloConnected || freeSearchPending
                    }
                    onClick={() => freeSearch.mutate(pendingApolloSearch)}
                  >
                    {freeSearchPending
                      ? "Retrying same request…"
                      : "Retry same request"}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="hunt-apollo-cancel-search"
                    disabled={cancelSearchPending}
                    onClick={() =>
                      cancelSearch.mutate({
                        idempotencyKey: pendingApolloSearch.idempotencyKey,
                      })
                    }
                  >
                    {cancelSearchPending ? "Cancelling…" : "Cancel search"}
                  </button>
                )
              ) : null}
            </div>
          </form>

          {isUiPrincipalCurrent && searchNote ? (
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

          {isUiPrincipalCurrent &&
          (apolloSearchResult?.candidates ?? []).length > 0 ? (
            <ol className="growth-candidates" data-testid="hunt-apollo-results">
              {(apolloSearchResult?.candidates ?? []).map((candidate) => {
                const saved = savedCandidateByExternalId.get(
                  candidate.externalId,
                );
                return (
                  <li
                    key={candidate.externalId}
                    className={saved ? "is-saved" : undefined}
                    data-testid={`hunt-apollo-candidate-${candidate.externalId}`}
                  >
                    <div>
                      <strong>
                        {saved?.fullName ??
                          candidate.fullName ??
                          "Named person unavailable"}
                      </strong>
                      <span>
                        {[candidate.title, candidate.companyName]
                          .filter(Boolean)
                          .join(" · ") || "Professional profile"}
                      </span>
                      <small>
                        {candidate.companyDomain ?? "Domain unavailable"} ·
                        email not unlocked by search
                      </small>
                      {saved ? (
                        <small className="growth-pipeline-state">
                          ✓ Saved in the CRM pipeline
                        </small>
                      ) : (
                        <small className="growth-unsaved-state">
                          Search result only · not saved to CRM
                        </small>
                      )}
                    </div>
                    <div className="growth-candidate-actions">
                      <button
                        type="button"
                        className={saved ? "growth-added-button" : undefined}
                        data-testid={`hunt-apollo-save-${candidate.externalId}`}
                        disabled={
                          !canOperateApollo ||
                          Boolean(saved) ||
                          (saveCandidate.isPending &&
                            saveCandidate.variables?.candidate.externalId ===
                              candidate.externalId)
                        }
                        onClick={() =>
                          saveCandidate.mutate({
                            candidate: {
                              externalId: candidate.externalId,
                              fullName: candidate.fullName,
                              title: candidate.title,
                              companyName: candidate.companyName,
                              companyDomain: candidate.companyDomain,
                            },
                          })
                        }
                      >
                        {saveCandidate.isPending &&
                        saveCandidate.variables?.candidate.externalId ===
                          candidate.externalId
                          ? "Adding…"
                          : saved
                            ? "Added to pipeline ✓"
                            : "Add to pipeline · free"}
                      </button>
                      {saved ? (
                        <>
                          <Link href={`/crm/deals/${saved.dealId}`}>
                            Open this lead in CRM →
                          </Link>
                          <span>Next: build the research brief.</span>
                        </>
                      ) : null}
                      <span
                        className="growth-email-state"
                        data-testid="hunt-apollo-enrichment-locked"
                      >
                        {saved?.email
                          ? `Work email: ${saved.email} · ${saved.emailVerified ? "verified" : "needs verification"}`
                          : "Work email: not unlocked"}
                      </span>
                      {creditReviewId === candidate.externalId ? (
                        <>
                          <span className="growth-credit-warning">
                            Confirm {candidate.fullName ?? "this exact person"}{" "}
                            at {candidate.companyName ?? "this company"}. Apollo
                            may use up to 1 credit; phone, personal email, and
                            waterfall lookups stay off.
                          </span>
                          <button
                            type="button"
                            className="growth-email-unlock"
                            data-testid={`hunt-apollo-enrich-confirm-${candidate.externalId}`}
                            disabled={
                              approveExact.isPending || enrichExact.isPending
                            }
                            onClick={() =>
                              approveExact.mutate({
                                candidate: {
                                  externalId: candidate.externalId,
                                  fullName: candidate.fullName,
                                  title: candidate.title,
                                  companyName: candidate.companyName,
                                  companyDomain: candidate.companyDomain,
                                },
                                confirmCreditUse: true,
                              })
                            }
                          >
                            {approveExact.isPending || enrichExact.isPending
                              ? "Unlocking…"
                              : "Confirm unlock · up to 1 credit"}
                          </button>
                          <button
                            type="button"
                            data-testid={`hunt-apollo-enrich-cancel-${candidate.externalId}`}
                            disabled={
                              approveExact.isPending || enrichExact.isPending
                            }
                            onClick={() => setCreditReviewId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="growth-email-unlock"
                          data-testid={`hunt-apollo-enrich-${candidate.externalId}`}
                          title={
                            !apolloControlsReady
                              ? "Checking your employee access and Apollo connection"
                              : !apolloConnected
                                ? "Connect Apollo before unlocking an email"
                                : !canOperateApollo
                                  ? "A Sales operator role is required"
                                  : !saved
                                    ? "Add this lead to the pipeline before unlocking an email"
                                    : "Review an exact-person confirmation before using up to one Apollo credit"
                          }
                          disabled={
                            !canOperateApollo ||
                            !apolloConnected ||
                            !saved ||
                            Boolean(saved?.email) ||
                            approveExact.isPending ||
                            enrichExact.isPending
                          }
                          onClick={() =>
                            setCreditReviewId(candidate.externalId)
                          }
                        >
                          {saved?.email
                            ? "Work email unlocked ✓"
                            : !apolloControlsReady
                              ? "Checking email access…"
                              : !apolloConnected
                                ? "Connect Apollo to unlock email"
                                : !canOperateApollo
                                  ? "Sales operator access required"
                                  : !saved
                                    ? "Add to pipeline first"
                                    : "Review email unlock · up to 1 credit"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>

        <aside className="growth-panel growth-connection-panel">
          <div className="growth-panel-heading">
            <div>
              <p className="growth-kicker">Connected tool</p>
              <h2>Apollo status</h2>
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
                {!apolloControlsReady
                  ? "Checking connection"
                  : apolloConnected
                    ? "Connected"
                    : "Not connected"}
              </dd>
            </div>
            <div>
              <dt>People Search</dt>
              <dd>
                {apolloProviderVerified
                  ? "Working · 0 credits"
                  : apolloConnected
                    ? "Ready · 0 credits"
                    : "Unavailable · 0 credits"}
              </dd>
            </div>
            <div>
              <dt>Work-email credits left</dt>
              <dd data-testid="hunt-apollo-credit-balance">
                {leadCredits
                  ? `${leadCredits.leftOver.toLocaleString()} live`
                  : !apolloCreditsReady
                    ? "Checking Apollo"
                    : (apolloCredits.data?.message ?? "Unavailable")}
              </dd>
            </div>
            {leadCredits ? (
              <div>
                <dt>Current credit cycle</dt>
                <dd>
                  {leadCredits.consumed.toLocaleString()} used of{" "}
                  {leadCredits.limit.toLocaleString()}
                  {liveCredits?.cycle.endDate
                    ? ` · resets ${new Date(liveCredits.cycle.endDate).toLocaleDateString()}`
                    : ""}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Paid details</dt>
              <dd>{paidDetailsLabel}</dd>
            </div>
            <div>
              <dt>Private details</dt>
              <dd>Phone + personal email never requested</dd>
            </div>
            <div>
              <dt>Outbound</dt>
              <dd>Draft only · no automatic send</dd>
            </div>
          </dl>
          <button
            type="button"
            className="growth-text-link"
            disabled={apolloCredits.isFetching || !apolloConnected}
            onClick={() => void apolloCredits.refetch()}
          >
            {apolloCredits.isFetching
              ? "Refreshing balance…"
              : "Refresh live balance"}
          </button>
          {liveCredits ? (
            <details className="growth-runtime">
              <summary>See every Apollo credit type</summary>
              <dl className="growth-guardrails">
                {Object.entries(liveCredits.credits).map(([kind, bucket]) => (
                  <div key={kind}>
                    <dt>
                      {APOLLO_CREDIT_LABELS[kind] ?? kind.replace(/_/g, " ")}
                    </dt>
                    <dd>
                      {bucket.leftOver.toLocaleString()} left ·{" "}
                      {bucket.consumed.toLocaleString()} used ·{" "}
                      {bucket.limit.toLocaleString()} allowance
                    </dd>
                  </div>
                ))}
              </dl>
              <p>
                Live Apollo team figures. Credit types are not added together;
                unified plans may share the lead-credit pool.
              </p>
            </details>
          ) : null}
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

      <section className="growth-panel" aria-labelledby="sales-next-steps">
        <div className="growth-panel-heading">
          <div>
            <p className="growth-kicker">What happens after Apollo</p>
            <h2 id="sales-next-steps">One lead, one clear route</h2>
          </div>
        </div>
        <div className="crm-checklist">
          <div className="crm-check-row">
            <strong>1 · Save the right person</strong>
            <span>Free search result → CRM lead</span>
          </div>
          <div className="crm-check-row">
            <strong>2 · Unlock work email only if useful</strong>
            <span>Exact person · up to 1 Apollo credit</span>
          </div>
          <div className="crm-check-row">
            <strong>3 · Build the knowledge brief</strong>
            <span>Live sources → pain points → hrmny angle</span>
          </div>
          <div className="crm-check-row">
            <strong>4 · Review channel drafts</strong>
            <span>Email + LinkedIn copy · nothing sent</span>
          </div>
          <div className="crm-check-row">
            <strong>5 · Approve and deliver</strong>
            <span>Gmail second click · LinkedIn manual handoff</span>
          </div>
        </div>
        <div className="growth-header-actions">
          <Link href="/crm" className="growth-primary-link">
            Continue in pipeline →
          </Link>
          <Link href="/crm/outreach" className="growth-text-link">
            Open outreach queue
          </Link>
        </div>
      </section>

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
                disabled={!isUiPrincipalCurrent}
                value={isUiPrincipalCurrent ? syntheticCompany : ""}
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
                  !isUiPrincipalCurrent ||
                  apolloImportPending ||
                  syntheticCompany.trim().length < 2
                }
                onClick={() => {
                  setResult(null);
                  apolloImport.mutate({ query: syntheticCompany.trim() });
                }}
              >
                {apolloImportPending
                  ? "Importing…"
                  : "Create synthetic Apollo fixture"}
              </button>
              <button
                type="button"
                disabled={!isUiPrincipalCurrent || demoPending}
                onClick={() => {
                  setResult(null);
                  demo.mutate({});
                }}
              >
                {demoPending ? "Running…" : "Run demo closed loop"}
              </button>
              <button
                type="button"
                data-testid="hunt-closed-loop-apollo"
                disabled={
                  !isUiPrincipalCurrent ||
                  demoPending ||
                  syntheticCompany.trim().length < 2
                }
                onClick={() => {
                  setResult(null);
                  demo.mutate({
                    viaApollo: true,
                    companyName: syntheticCompany.trim(),
                  });
                }}
              >
                {demoPending ? "Running…" : "Closed loop via Apollo"}
              </button>
              {isUiPrincipalCurrent && lastApolloDealId ? (
                <Link
                  data-testid="hunt-apollo-open-deal"
                  href={`/crm/deals/${lastApolloDealId}`}
                >
                  Open deal
                </Link>
              ) : null}
            </div>

            {demoResultPrincipalId === verifiedStaffPrincipalId &&
            demo.data &&
            demo.data.ok ? (
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

            {isUiPrincipalCurrent && result ? (
              <div
                className="growth-status"
                role="status"
                aria-live="polite"
                data-testid="hunt-closed-loop-status"
              >
                <p>{result}</p>
                {demoResultPrincipalId === verifiedStaffPrincipalId &&
                demo.data &&
                demo.data.ok ? (
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
                    <Link
                      data-testid="hunt-status-portal"
                      href={demo.data.next.portal}
                    >
                      Preview client approvals
                    </Link>
                    <Link
                      data-testid="hunt-status-onboarding"
                      href={demo.data.next.onboarding}
                    >
                      Review onboarding board
                    </Link>
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
