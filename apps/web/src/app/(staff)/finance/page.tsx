"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { usePageTitle } from "@/components/use-page-title";

export default function FinanceQueuePage() {
  usePageTitle("Money");
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const canViewMargin = session.data?.canViewMargin ?? false;
  const isDemo = session.data?.authMode !== "supabase";
  const proposals = trpc.invoices.proposals.useQuery();
  const invoices = trpc.invoices.list.useQuery();
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

  async function runIntake() {
    const row = await intake.mutateAsync({
      emailRef: `msg-${Date.now()}`,
      bodyHint,
    });
    setLast(row);
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
          Money
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">
          Invoice intake
        </h1>
        <p className="mt-2 text-muted">
          Email intake → AI propose → human approve → post to Xero. Unknown TRN
          is held, never guessed.
        </p>
      </div>
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Money sections">
        <Link
          className="rounded-full bg-ink px-4 py-2 text-white"
          href="/finance"
        >
          Intake
        </Link>
        <Link
          className="rounded-full border border-sand bg-paper px-4 py-2"
          href="/billing"
        >
          Billing & retainers
        </Link>
        {canViewMargin ? (
          <Link
            className="rounded-full border border-sand bg-paper px-4 py-2"
            href="/margin"
          >
            Margin
          </Link>
        ) : null}
        <Link
          className="rounded-full border border-sand bg-paper px-4 py-2"
          href="/dashboards"
        >
          Dashboards
        </Link>
      </nav>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Invoice email body hint</span>
        <textarea
          className="min-h-[72px] rounded border border-sand bg-white px-3 py-2"
          value={bodyHint}
          onChange={(e) => setBodyHint(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void runIntake()} disabled={intake.isPending}>
          1. Intake (AI propose)
        </Button>
        {isDemo ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void reset.mutateAsync()}
          >
            Reset demo finance
          </Button>
        ) : null}
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Proposals</p>
        <ul className="mt-3 flex flex-col gap-3">
          {(proposals.data ?? []).map((p) => (
            <li key={p.proposalId} className="border-t border-sand/60 pt-3 text-sm">
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
        <p className="text-sm text-muted">Invoices</p>
        <ul className="mt-3 flex flex-col gap-3">
          {(invoices.data ?? []).map((inv) => (
            <li key={inv.invoiceId} className="border-t border-sand/60 pt-3 text-sm">
              <p>
                {inv.status} · {inv.contactName} · AED {inv.amount} (+VAT{" "}
                {inv.vatAmount}) · xero: {inv.xeroInvoiceId ?? "—"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {inv.status === "proposed" ? (
                  <Button
                    type="button"
                    onClick={async () => {
                      const r = await approve.mutateAsync({ id: inv.invoiceId });
                      setLast(r);
                    }}
                  >
                    3. Approve invoice
                  </Button>
                ) : null}
                {inv.status === "approved" ? (
                  <Button
                    type="button"
                    onClick={async () => {
                      const r = await issue.mutateAsync({ id: inv.invoiceId });
                      setLast(r);
                    }}
                  >
                    4. Post to Xero
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
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
