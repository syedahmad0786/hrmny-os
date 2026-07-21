"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import Link from "next/link";

export default function GateDemoPage() {
  const utils = trpc.useUtils();
  const deal = trpc.deals.get.useQuery({
    id: "e0000000-0000-4000-8000-000000000001",
  });
  const health = trpc.admin.health.get.useQuery();
  const transition = trpc.deals.transition.useMutation({
    onSuccess: () => void utils.deals.invalidate(),
  });
  const reset = trpc.deals.resetDemo.useMutation({
    onSuccess: () => void utils.deals.invalidate(),
  });
  const emitHealth = trpc.admin.health.emitStub.useMutation({
    onSuccess: () => void utils.admin.health.get.invalidate(),
  });
  const [last, setLast] = useState<unknown>(null);
  const [healthLast, setHealthLast] = useState<unknown>(null);

  async function run(to: string) {
    const result = await transition.mutateAsync({
      id: "e0000000-0000-4000-8000-000000000001",
      to,
      from: deal.data?.stage,
    });
    setLast(result);
    await utils.admin.audit.list.invalidate();
  }

  async function tripHealth() {
    const result = await emitHealth.mutateAsync({
      signalKey: "m1_demo_trip",
      severity: "warn",
    });
    setHealthLast(result);
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Gate demo</h1>
      <p className="text-muted">
        Deal stage machine: illegal transitions return{" "}
        <code>GATE_BLOCKED</code> <strong>with</strong> an audit row; legal ones
        persist <code>audit_event</code> with before/after. Also trip a health
        signal for the M1 Chat/stub criterion.
      </p>
      <div className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm text-muted">Current deal</p>
        <pre className="mt-2 overflow-x-auto text-sm">
          {JSON.stringify(deal.data ?? null, null, 2)}
        </pre>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void run("qualify")} disabled={transition.isPending}>
          discover → qualify (legal)
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void run("close")}
          disabled={transition.isPending}
        >
          → close (illegal — audited block)
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void reset.mutateAsync()}
        >
          Reset deal
        </Button>
        <Button
          type="button"
          onClick={() => void tripHealth()}
          disabled={emitHealth.isPending}
        >
          Trip health signal
        </Button>
      </div>
      <p className="text-sm text-muted">
        Chat webhook configured:{" "}
        {health.data?.chatWebhookConfigured ? "yes (POST live)" : "no (stub recorded)"} ·{" "}
        <Link className="underline" href="/admin/audit">
          Audit log
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/conventions">
          Conventions
        </Link>{" "}
        ·{" "}
        <Link className="underline" href="/roles">
          Roles / margin
        </Link>
      </p>
      {last ? (
        <div className="rounded-lg border border-sand bg-white/70 p-4">
          <p className="text-sm text-muted">Last transition result</p>
          <pre className="mt-2 overflow-x-auto text-sm">
            {JSON.stringify(last, null, 2)}
          </pre>
        </div>
      ) : null}
      {healthLast ? (
        <div className="rounded-lg border border-sand bg-white/70 p-4">
          <p className="text-sm text-muted">Last health trip</p>
          <pre className="mt-2 overflow-x-auto text-sm">
            {JSON.stringify(healthLast, null, 2)}
          </pre>
        </div>
      ) : null}
      {health.data?.signals?.length ? (
        <div className="rounded-lg border border-sand bg-white/70 p-4">
          <p className="text-sm text-muted">Recent health signals</p>
          <pre className="mt-2 overflow-x-auto text-sm">
            {JSON.stringify(health.data.signals.slice(0, 5), null, 2)}
          </pre>
        </div>
      ) : null}
    </main>
  );
}
