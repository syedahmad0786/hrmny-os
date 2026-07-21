"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

const SAMPLE_CSV = `external_id,display_name,email,department,basic_salary,leave_balance
bz-001,New Hire Candidate,newhire@hrmny.local,Creative,14000,12
bz-002,Amina Khalil,amina@hrmny.local,Finance,12000,14
`;

export default function HrLifecyclePage() {
  const utils = trpc.useUtils();
  const employees = trpc.employees.list.useQuery();
  const escalations = trpc.employees.escalations.useQuery();
  const mirror = trpc.employees.bayzatMirror.useQuery();
  const dash = trpc.dashboards.hrLifecycle.useQuery();
  const accept = trpc.employees.acceptOffer.useMutation({
    onSuccess: () => void utils.employees.invalidate(),
  });
  const transition = trpc.employees.lifecycle.transition.useMutation({
    onSuccess: () => void utils.employees.invalidate(),
  });
  const escalate = trpc.employees.runEscalationJob.useMutation({
    onSuccess: () => {
      void utils.employees.invalidate();
      void utils.dashboards.hrLifecycle.invalidate();
    },
  });
  const importCsv = trpc.employees.importBayzatCsv.useMutation({
    onSuccess: () => void utils.employees.invalidate(),
  });
  const [last, setLast] = useState<unknown>(null);
  const [csv, setCsv] = useState(SAMPLE_CSV);

  const emp = employees.data?.[0];

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">HR lifecycle</h1>
      <p className="text-muted">
        9-phase employee machine + escalation job stub. Bayzat is read-only
        (CSV import fallback).
      </p>

      <div className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
        <p className="text-muted">Dashboard by phase</p>
        <pre className="mt-2 text-xs">{JSON.stringify(dash.data ?? {}, null, 2)}</pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!emp || accept.isPending}
          onClick={async () => {
            if (!emp) return;
            setLast(await accept.mutateAsync({ id: emp.employeeId }));
          }}
        >
          Accept offer → spawn hire_packet
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!emp || transition.isPending}
          onClick={async () => {
            if (!emp) return;
            setLast(
              await transition.mutateAsync({
                id: emp.employeeId,
                to: "onboarding",
                payload: {
                  checklist: { docs_signed: true, access_triggered: true },
                },
              }),
            );
          }}
        >
          Complete hire_packet → onboarding
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={async () => setLast(await escalate.mutateAsync())}
        >
          Run escalation job
        </Button>
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Employees</p>
        <pre className="mt-2 overflow-x-auto text-xs">
          {JSON.stringify(employees.data ?? [], null, 2)}
        </pre>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Escalations</p>
        <pre className="mt-2 overflow-x-auto text-xs">
          {JSON.stringify(escalations.data ?? [], null, 2)}
        </pre>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Bayzat CSV import (read-only mirror)</p>
        <textarea
          className="min-h-[100px] rounded border border-sand bg-white px-3 py-2 font-mono text-xs"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <Button
          type="button"
          onClick={async () => setLast(await importCsv.mutateAsync({ csvText: csv }))}
        >
          Import CSV → mirror
        </Button>
        <pre className="overflow-x-auto text-xs">
          {JSON.stringify(mirror.data ?? [], null, 2)}
        </pre>
      </section>

      {last ? (
        <pre className="overflow-x-auto rounded-lg border border-sand bg-white/70 p-4 text-xs">
          {JSON.stringify(last, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}
