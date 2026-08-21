"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import { useState } from "react";

export default function RetainerBillingPage() {
  const utils = trpc.useUtils();
  const clients = trpc.clients.list.useQuery();
  const invoices = trpc.invoices.list.useQuery();
  const reset = trpc.m5.reset.useMutation({
    onSuccess: () => {
      void utils.clients.invalidate();
      void utils.invoices.invalidate();
    },
  });
  const draftMonth = trpc.invoices.draftRetainersForMonth.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const draft = trpc.invoices.draft.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const approve = trpc.invoices.approve.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const issue = trpc.invoices.issue.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const markPaid = trpc.invoices.markPaidFromWebhook.useMutation({
    onSuccess: () => void utils.invoices.invalidate(),
  });
  const syncXero = trpc.invoices.syncXeroMirror.useMutation({
    onSuccess: (r) => setLast(r),
  });
  const [last, setLast] = useState<unknown>(null);
  const period = new Date().toISOString().slice(0, 7);
  const retainerClient = (clients.data ?? []).find(
    (c) => c.engagementType === "retainer",
  );
  const demoResets = showDemoResets();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Retainer billing</h1>
      <p className="text-muted">
        Monthly retainer draft (VAT 5%) → approve → mark issued in OS. Xero is
        mirrored read-only — OS never posts invoices to Xero.
      </p>

      <div className="flex flex-wrap gap-2">
        {demoResets ? (
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              const r = await reset.mutateAsync();
              setLast(r);
            }}
          >
            Reset M5 demo
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={async () => {
            const r = await draftMonth.mutateAsync({ period });
            setLast(r);
          }}
          disabled={draftMonth.isPending}
        >
          1. Auto-draft retainers ({period})
        </Button>
        {retainerClient ? (
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              const r = await draft.mutateAsync({
                clientId: retainerClient.clientId,
                type: "progress",
                period,
              });
              setLast(r);
            }}
          >
            Draft progress invoice
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            const r = await syncXero.mutateAsync();
            setLast(r);
          }}
          disabled={syncXero.isPending}
        >
          {syncXero.isPending ? "Syncing…" : "Sync Xero mirror (read-only)"}
        </Button>
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Invoices</p>
        <ul className="mt-3 flex flex-col gap-3">
          {(invoices.data ?? []).map((inv) => (
            <li
              key={inv.invoiceId}
              className="border-t border-sand/60 pt-3 text-sm"
            >
              <p>
                {inv.status} · {inv.billingKind} · {inv.contactName} · AED{" "}
                {inv.amount} (+VAT {inv.vatAmount}) · {inv.period ?? "—"} ·
                xero: {inv.xeroInvoiceId ?? "—"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {inv.status === "draft" || inv.status === "proposed" ? (
                  <Button
                    type="button"
                    onClick={async () => {
                      const r = await approve.mutateAsync({ id: inv.invoiceId });
                      setLast(r);
                    }}
                  >
                    2. Approve
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
                    3. Mark issued (OS only)
                  </Button>
                ) : null}
                {inv.status === "issued" && inv.xeroInvoiceId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={async () => {
                      const r = await markPaid.mutateAsync({
                        xeroInvoiceId: inv.xeroInvoiceId!,
                      });
                      setLast(r);
                    }}
                  >
                    4. Webhook: paid
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
