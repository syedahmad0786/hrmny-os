"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import { useState } from "react";

export default function PayrollRunPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const runs = trpc.payroll.runs.list.useQuery();
  const reset = trpc.m5.reset.useMutation({
    onSuccess: () => void utils.payroll.invalidate(),
  });
  const draft = trpc.payroll.runs.draft.useMutation({
    onSuccess: () => void utils.payroll.invalidate(),
  });
  const confirm = trpc.payroll.runs.confirm.useMutation({
    onSuccess: () => void utils.payroll.invalidate(),
  });
  const approve = trpc.payroll.runs.approve.useMutation({
    onSuccess: () => void utils.payroll.invalidate(),
  });
  const post = trpc.payroll.runs.post.useMutation({
    onSuccess: () => void utils.payroll.invalidate(),
  });
  const [last, setLast] = useState<unknown>(null);
  const period = new Date().toISOString().slice(0, 7);
  const demoResets = showDemoResets();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Payroll run</h1>
      <p className="text-muted">
        Bayzat/OS draft → HR confirm → Director/partner approve → finalize in
        OS. Xero journal posts are disabled (read/mirror only). OS never
        disburses.
      </p>
      <p className="text-sm">
        <Link className="underline" href="/people">
          People headcount
        </Link>
        {" · "}
        <Link className="underline" href="/workforce-payroll">
          Pay & expenses
        </Link>
        {" · "}
        <Link className="underline" href="/finance">
          Finance mirror
        </Link>
      </p>
      <p className="text-sm text-muted">
        Current role: {(session.data?.roles ?? []).join(", ") || "—"}
      </p>

      <div className="flex flex-wrap gap-2">
        {demoResets ? (
          <Button
            type="button"
            variant="ghost"
            onClick={async () => setLast(await reset.mutateAsync())}
          >
            Reset M5 demo
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={async () => {
            const r = await draft.mutateAsync({ period });
            setLast(r);
          }}
          disabled={draft.isPending}
        >
          1. Draft from Bayzat ({period})
        </Button>
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Runs</p>
        <ul className="mt-3 flex flex-col gap-4">
          {(runs.data ?? []).map((run) => (
            <li
              key={run.payrollRunId}
              className="border-t border-sand/60 pt-3 text-sm"
            >
              <p>
                {run.status} · {run.period} · total AED {run.totalGross} · JE:{" "}
                {run.xeroJournalId ?? "—"} · disbursed: {String(run.disbursed)}
              </p>
              <p className="mt-1 text-muted">
                confirmedBy: {run.confirmedByEmployeeId ?? "—"} · approvedBy:{" "}
                {run.approvedByEmployeeId ?? "—"}
              </p>
              <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                {run.lines.map((l) => (
                  <li key={l.externalId}>
                    {l.displayName} · AED {l.grossAmount}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {run.status === "draft" ? (
                  <Button
                    type="button"
                    onClick={async () => {
                      const r = await confirm.mutateAsync({
                        id: run.payrollRunId,
                      });
                      setLast(r);
                    }}
                  >
                    2. HR confirm
                  </Button>
                ) : null}
                {run.status === "hr_confirmed" ? (
                  <Button
                    type="button"
                    onClick={async () => {
                      const r = await approve.mutateAsync({
                        id: run.payrollRunId,
                      });
                      setLast(r);
                    }}
                  >
                    3. Director approve
                  </Button>
                ) : null}
                {run.status === "director_approved" ? (
                  <>
                    <Button
                      type="button"
                      onClick={async () => {
                        const r = await post.mutateAsync({
                          id: run.payrollRunId,
                        });
                        setLast(r);
                      }}
                    >
                      4. Finalize in OS (no Xero write)
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={async () => {
                        const r = await post.mutateAsync({
                          id: run.payrollRunId,
                          disburse: true,
                        });
                        setLast(r);
                      }}
                    >
                      Try disburse (must fail)
                    </Button>
                  </>
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
