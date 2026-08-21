"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";

function FinanceQueueInner() {
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const focusInvoiceId = searchParams.get("invoiceId");
  const session = trpc.auth.session.useQuery();
  const canViewMargin = session.data?.canViewMargin ?? false;
  const proposals = trpc.invoices.proposals.useQuery();
  const invoices = trpc.invoices.list.useQuery();
  const mirror = trpc.invoices.mirrorFromXero.useQuery();
  const intake = trpc.invoices.intake.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const decide = trpc.invoices.intakeDecide.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const approve = trpc.invoices.approve.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const issue = trpc.invoices.issue.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const reset = trpc.invoices.resetDemo.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const [last, setLast] = useState<unknown>(null);
  const [bodyHint, setBodyHint] = useState(
    "ACME Supplies LLC invoice AED 2100.00 — TRN on file",
  );
  const demoResets = showDemoResets();

  const orderedInvoices = useMemo(() => {
    const list = invoices.data ?? [];
    if (!focusInvoiceId) return list;
    return [...list].sort((a, b) => {
      if (a.invoiceId === focusInvoiceId) return -1;
      if (b.invoiceId === focusInvoiceId) return 1;
      return 0;
    });
  }, [invoices.data, focusInvoiceId]);

  useEffect(() => {
    if (!focusInvoiceId) return;
    const el = document.getElementById(`os-invoice-${focusInvoiceId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusInvoiceId, orderedInvoices]);

  async function runIntake() {
    const row = await intake.mutateAsync({
      emailRef: `msg-${Date.now()}`,
      bodyHint,
    });
    setLast(row);
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Finance queue</h1>
      <p className="text-muted">
        Intake → AI propose (HITL) → approve → mark issued in OS. Xero remains
        source of truth — OS reads/mirrors only and never writes.
      </p>
      <p className="text-sm">
        <Link className="underline" href="/billing">
          Billing & invoices
        </Link>
        {canViewMargin ? (
          <>
            {" · "}
            <Link className="underline" href="/margin">
              Margin
            </Link>
          </>
        ) : null}
        {" · "}
        <Link className="underline" href="/dashboards">
          Dashboards
        </Link>
        {" · "}
        <Link className="underline" href="/payroll">
          Payroll prep
        </Link>
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Invoice email body hint</span>
        <textarea
          className="min-h-[72px] rounded border border-sand bg-white px-3 py-2"
          data-testid="finance-intake-hint"
          value={bodyHint}
          onChange={(e) => setBodyHint(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="finance-intake"
          onClick={() => void runIntake()}
          disabled={intake.isPending}
        >
          1. Intake (AI propose)
        </Button>
        {demoResets ? (
          <Button
            type="button"
            variant="ghost"
            data-testid="finance-reset"
            onClick={() => void reset.mutateAsync()}
          >
            Reset M2 finance
          </Button>
        ) : null}
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">
          Synced from Xero ({mirror.data?.mode ?? "…"} · writeEnabled=
          {String(mirror.data?.writeEnabled ?? false)})
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {(mirror.data?.invoices ?? []).map((row) => {
            const externalId = row.xeroInvoiceId ?? row.invoiceId;
            const syncedAt =
              row.sourceAttached &&
              typeof row.sourceAttached === "object" &&
              "syncedAt" in row.sourceAttached
                ? String(
                    (row.sourceAttached as { syncedAt?: string }).syncedAt ??
                      "",
                  )
                : "";
            return (
              <li key={externalId} className="border-t border-sand/60 pt-2">
                {row.status} · {row.contactName} · {row.currency} {row.amount} ·{" "}
                {externalId}
                {syncedAt ? (
                  <span className="block text-xs text-muted">
                    mirrored {syncedAt}
                  </span>
                ) : null}
              </li>
            );
          })}
          {!mirror.data?.invoices?.length && !mirror.isLoading ? (
            <li className="text-muted">No mirrored invoices yet.</li>
          ) : null}
        </ul>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Proposals</p>
        <ul className="mt-3 flex flex-col gap-3">
          {(proposals.data ?? []).map((p) => (
            <li
              key={p.proposalId}
              className="border-t border-sand/60 pt-3 text-sm"
              data-testid="finance-proposal"
              data-proposal-status={p.status}
              data-proposal-id={p.proposalId}
            >
              <p>
                {p.status} · {p.emailRef}
              </p>
              <pre className="mt-1 overflow-x-auto text-xs">
                {JSON.stringify(p.payload, null, 2)}
              </pre>
              {p.status === "pending" ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    data-testid="finance-approve-proposal"
                    onClick={async () => {
                      const r = await decide.mutateAsync({
                        proposalId: p.proposalId,
                        decision: "approve",
                      });
                      setLast(r);
                    }}
                  >
                    2. Approve proposal
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid="finance-reject-proposal"
                    onClick={async () => {
                      const r = await decide.mutateAsync({
                        proposalId: p.proposalId,
                        decision: "reject",
                      });
                      setLast(r);
                    }}
                  >
                    Reject
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">OS invoices (not written to Xero)</p>
        <ul className="mt-3 flex flex-col gap-3">
          {orderedInvoices.map((inv) => {
            const focused = focusInvoiceId === inv.invoiceId;
            return (
              <li
                key={inv.invoiceId}
                id={`os-invoice-${inv.invoiceId}`}
                data-testid="finance-invoice"
                data-invoice-id={inv.invoiceId}
                data-invoice-status={inv.status}
                data-selected={focused ? "true" : undefined}
                className={`border-t border-sand/60 pt-3 text-sm ${
                  focused
                    ? "rounded-lg border border-ochre bg-white px-3 pb-3 ring-2 ring-ochre/40"
                    : ""
                }`}
              >
                <p>
                  {inv.status} · {inv.contactName} · AED {inv.amount} (+VAT{" "}
                  {inv.vatAmount}) · xero mirror id: {inv.xeroInvoiceId ?? "—"}
                  {focused ? (
                    <span className="ml-2 text-xs font-medium text-ochre">
                      From handover
                    </span>
                  ) : null}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!("readOnly" in inv && inv.readOnly) &&
                  inv.status === "proposed" ? (
                    <Button
                      type="button"
                      data-testid="finance-approve-invoice"
                      onClick={async () => {
                        const r = await approve.mutateAsync({
                          id: inv.invoiceId,
                        });
                        setLast(r);
                      }}
                    >
                      3. Approve invoice
                    </Button>
                  ) : null}
                  {!("readOnly" in inv && inv.readOnly) &&
                  inv.status === "approved" ? (
                    <Button
                      type="button"
                      data-testid="finance-issue-invoice"
                      onClick={async () => {
                        const r = await issue.mutateAsync({ id: inv.invoiceId });
                        setLast(r);
                      }}
                    >
                      4. Mark issued (OS only)
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {last ? (
        <pre className="overflow-x-auto rounded-lg border border-sand bg-white/70 p-4 text-xs">
          {JSON.stringify(last, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}

export default function FinanceQueuePage() {
  return (
    <Suspense>
      <FinanceQueueInner />
    </Suspense>
  );
}
