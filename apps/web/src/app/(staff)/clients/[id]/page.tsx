"use client";

import Link from "next/link";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OnboardingReadyBanner } from "@/components/onboarding-ready-banner";

export default function ClientOnboardingPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;
  const focusPhaseRaw = searchParams.get("phase");
  const focusPhase =
    focusPhaseRaw != null && focusPhaseRaw !== ""
      ? Number(focusPhaseRaw)
      : null;
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const canAccessInvoices = Boolean(
    session.data?.roles.some((role) =>
      ["partner", "director", "finance"].includes(role),
    ),
  );
  const client = trpc.clients.get.useQuery({ id });
  const onboarding = trpc.clients.onboarding.get.useQuery({ clientId: id });
  const immersion = trpc.clients.immersion.get.useQuery({ clientId: id });
  const tasks = trpc.tasks.list.useQuery({ clientId: id });
  const calendars = trpc.calendars.listByClient.useQuery({ clientId: id });
  const invoices = trpc.invoices.list.useQuery(undefined, {
    enabled: canAccessInvoices,
    retry: false,
  });
  const dealId =
    client.data &&
    "dealId" in client.data &&
    typeof client.data.dealId === "string"
      ? client.data.dealId
      : null;
  const outreach = trpc.leadgen.outreach.list.useQuery(
    { dealId: dealId! },
    { enabled: Boolean(dealId) },
  );
  const campaigns = trpc.campaigns.list.useQuery({ clientId: id });
  const signoff = trpc.clients.onboarding.signoff.useMutation({
    onSuccess: () => void utils.clients.invalidate(),
  });
  const upsert = trpc.clients.immersion.upsert.useMutation({
    onSuccess: () => void utils.clients.invalidate(),
  });
  const reviewHref = trpc.clients.portalUsers.reviewHref.useMutation();

  const [usp, setUsp] = useState("");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  const creativeTaskId = useMemo(() => {
    const rows = tasks.data ?? [];
    const qc =
      rows.find((t) => t.status === "qc") ??
      rows.find((t) => t.status === "client_review") ??
      rows.find((t) =>
        /creative|cutdown|reel|social/i.test(
          `${t.taskType ?? ""} ${t.title ?? ""}`,
        ),
      ) ??
      rows[0];
    return qc?.taskId ?? null;
  }, [tasks.data]);
  const calendarId = calendars.data?.[0]?.calendarId ?? null;
  const invoiceId = useMemo(() => {
    const rows = (invoices.data ?? []).filter((inv) => inv.clientId === id);
    const first =
      rows.find((inv) => inv.billingKind === "first") ??
      rows.find((inv) => /first|handover|won/i.test(inv.ruleCited ?? "")) ??
      rows[0];
    return first?.invoiceId ?? null;
  }, [id, invoices.data]);
  const outreachId = outreach.data?.[0]?.id ?? null;
  // Approvals inbox only lists campaigns with status === "approved".
  // Handover seeds drafts — prefer outreach (always in the inbox), then an
  // approved campaign item. Never pin a draft campaign id (silent misfocus).
  const approvedCampaignItemId =
    campaigns.data?.find((c) => c.status === "approved")?.id ?? null;
  const continueLinks = useMemo(() => {
    const creativeQs = new URLSearchParams({ clientId: id });
    if (creativeTaskId) creativeQs.set("taskId", creativeTaskId);
    const accountQs = new URLSearchParams({ clientId: id });
    if (calendarId) accountQs.set("calendarId", calendarId);
    const approvalsId = outreachId ?? approvedCampaignItemId;
    return {
      account: `/account?${accountQs.toString()}`,
      creative: `/creative?${creativeQs.toString()}`,
      finance: (() => {
        const qs = new URLSearchParams({ clientId: id });
        if (invoiceId) qs.set("invoiceId", invoiceId);
        return `/finance?${qs.toString()}`;
      })(),
      outreach: (() => {
        const qs = new URLSearchParams({ clientId: id });
        if (outreachId) qs.set("id", outreachId);
        return `/crm/outreach?${qs.toString()}`;
      })(),
      approvals: (() => {
        const qs = new URLSearchParams({ clientId: id });
        if (approvalsId) qs.set("id", approvalsId);
        return `/approvals?${qs.toString()}`;
      })(),
    };
  }, [
    id,
    creativeTaskId,
    calendarId,
    invoiceId,
    outreachId,
    approvedCampaignItemId,
  ]);

  useEffect(() => {
    if (focusPhase == null || Number.isNaN(focusPhase)) return;
    if (!onboarding.data?.length) return;
    document
      .getElementById(`onboarding-phase-${focusPhase}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusPhase, onboarding.data]);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <Link href="/clients" className="text-sm text-ochre underline">
          ← Clients
        </Link>
        <h1 className="font-display text-3xl font-semibold">
          {client.data?.name ?? "Client"}
        </h1>
        <p className="text-muted">
          Onboarding 7-phase · Immersion form · renewal{" "}
          {client.data && "renewalDate" in client.data
            ? String(client.data.renewalDate)
            : "—"}
        </p>
        <OnboardingReadyBanner testIdPrefix="client-onboarding" />
        <nav
          className="mt-3 flex flex-wrap gap-2 text-sm"
          aria-label="Continue OS after handover"
          data-testid="client-continue-os"
        >
          <Link
            href={continueLinks.account}
            data-testid="client-continue-account"
            className="rounded-full border border-sand bg-white/80 px-3 py-1 text-ochre underline-offset-2 hover:underline"
          >
            Account calendar →
          </Link>
          <Link
            href={continueLinks.creative}
            data-testid="client-continue-creative"
            className="rounded-full border border-sand bg-white/80 px-3 py-1 text-ochre underline-offset-2 hover:underline"
          >
            Creative →
          </Link>
          <Link
            href={continueLinks.approvals}
            data-testid="client-continue-approvals"
            className="rounded-full border border-sand bg-white/80 px-3 py-1 text-ochre underline-offset-2 hover:underline"
          >
            Approvals →
          </Link>
          <Link
            href={continueLinks.outreach}
            data-testid="client-continue-outreach"
            className="rounded-full border border-sand bg-white/80 px-3 py-1 text-ochre underline-offset-2 hover:underline"
          >
            Outreach →
          </Link>
          {canAccessInvoices ? (
            <Link
              href={continueLinks.finance}
              data-testid="client-continue-finance"
              className="rounded-full border border-sand bg-white/80 px-3 py-1 text-ochre underline-offset-2 hover:underline"
            >
              Finance →
            </Link>
          ) : null}
          <button
            type="button"
            data-testid="client-continue-portal"
            className="rounded-full border border-sand bg-white/80 px-3 py-1 text-ochre underline-offset-2 hover:underline disabled:opacity-50"
            disabled={reviewHref.isPending}
            onClick={() => {
              setPortalMsg(null);
              void reviewHref
                .mutateAsync({ clientId: id, next: "/portal/approvals" })
                .then((data) => {
                  window.location.assign(data.portalPath);
                })
                .catch((err: unknown) => {
                  setPortalMsg(
                    err instanceof Error
                      ? err.message
                      : "Preview could not open",
                  );
                });
            }}
          >
            {reviewHref.isPending &&
            (reviewHref.variables?.next == null ||
              reviewHref.variables.next === "/portal/approvals")
              ? "Opening preview…"
              : "Preview approvals →"}
          </button>
          <button
            type="button"
            data-testid="client-continue-onboarding"
            className="rounded-full border border-sand bg-white/80 px-3 py-1 text-ochre underline-offset-2 hover:underline disabled:opacity-50"
            disabled={reviewHref.isPending}
            onClick={() => {
              setPortalMsg(null);
              void reviewHref
                .mutateAsync({ clientId: id, next: "/portal/onboarding" })
                .then((data) => {
                  window.location.assign(data.portalPath);
                })
                .catch((err: unknown) => {
                  setPortalMsg(
                    err instanceof Error
                      ? err.message
                      : "Onboarding could not open",
                  );
                });
            }}
          >
            {reviewHref.isPending &&
            reviewHref.variables?.next === "/portal/onboarding"
              ? "Opening onboarding…"
              : "Onboarding →"}
          </button>
        </nav>
        {portalMsg ? (
          <p className="mt-2 text-sm text-red-700">{portalMsg}</p>
        ) : null}
      </div>

      <section
        id="onboarding"
        className="rounded-lg border border-sand bg-white/70 p-4"
      >
        <h2 className="font-display text-lg">Onboarding board</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {(onboarding.data ?? []).map((phase) => (
            <li
              key={phase.phaseId}
              id={`onboarding-phase-${phase.phaseIndex}`}
              data-testid={
                focusPhase === phase.phaseIndex
                  ? "onboarding-phase-focus"
                  : `onboarding-phase-${phase.phaseIndex}`
              }
              data-phase-index={phase.phaseIndex}
              data-phase-status={phase.status}
              data-phase-name={phase.name}
              aria-current={
                focusPhase === phase.phaseIndex ? "true" : undefined
              }
              className={`border-t border-sand/60 pt-3 text-sm ${
                focusPhase === phase.phaseIndex
                  ? "rounded-md bg-cream/80 ring-1 ring-ochre/40"
                  : ""
              }`}
            >
              <p className="font-medium">
                P{phase.phaseIndex}: {phase.name}{" "}
                <span className="text-muted">({phase.status})</span>
              </p>
              <ul className="mt-1 text-xs text-muted">
                {phase.steps.map((s) => (
                  <li key={s.stepId}>
                    [{s.raci}] {s.title} {s.done ? "✓" : ""}
                  </li>
                ))}
              </ul>
              {phase.status === "active" ? (
                <Button
                  type="button"
                  className="mt-2"
                  data-testid="clients-onboarding-signoff"
                  onClick={() =>
                    void signoff.mutateAsync({
                      clientId: id,
                      phaseIndex: phase.phaseIndex,
                    })
                  }
                >
                  Sign off phase
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Immersion Form 3</h2>
        <div className="mt-3 flex max-w-lg flex-col gap-2 text-sm">
          <label>
            USP
            <input
              className="mt-1 w-full rounded border border-sand px-3 py-2"
              value={usp}
              onChange={(e) => setUsp(e.target.value)}
            />
          </label>
          <label>
            Audience
            <input
              className="mt-1 w-full rounded border border-sand px-3 py-2"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            />
          </label>
          <label>
            Objective priority
            <input
              className="mt-1 w-full rounded border border-sand px-3 py-2"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </label>
          <Button
            type="button"
            onClick={() =>
              void upsert.mutateAsync({
                clientId: id,
                usp,
                audience,
                objectivePriority: objective,
                swot: {
                  strengths: "Brand trust",
                  weaknesses: "Manual ops",
                  opportunities: "KSA",
                  threats: "Agency churn",
                },
                complete: true,
              })
            }
          >
            Save & complete immersion
          </Button>
        </div>
        <pre className="mt-3 overflow-x-auto text-xs">
          {JSON.stringify(immersion.data ?? [], null, 2)}
        </pre>
      </section>
    </main>
  );
}
