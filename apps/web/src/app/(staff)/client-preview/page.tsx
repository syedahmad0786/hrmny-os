"use client";

import Link from "next/link";
import { Button, Card } from "@hrmny/ui";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  hasSyntheticMarker,
  isSyntheticRecordName,
} from "@/lib/synthetic-records";

const readable = (value: string) => value.replaceAll("_", " ");

export default function ClientPreviewPage() {
  const clients = trpc.clients.list.useQuery();
  const [clientId, setClientId] = useState<string | undefined>();
  const operationalClients = useMemo(
    () =>
      (clients.data ?? []).filter(
        (client) => !isSyntheticRecordName(client.name),
      ),
    [clients.data],
  );
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("client");
    if (requested) setClientId(requested);
  }, []);
  useEffect(() => {
    if (
      operationalClients[0] &&
      (!clientId ||
        !operationalClients.some((client) => client.clientId === clientId))
    ) {
      setClientId(operationalClients[0].clientId);
    }
  }, [clientId, operationalClients]);
  const previewClientId = operationalClients.find(
    (client) => client.clientId === clientId,
  )?.clientId;
  const workspace = trpc.clientPreview.workspace.useQuery(
    previewClientId ? { clientId: previewClientId } : undefined,
    { enabled: Boolean(previewClientId) },
  );
  if (clients.isLoading || (previewClientId && workspace.isLoading)) {
    return (
      <main className="py-12 text-center text-muted">
        Loading client preview…
      </main>
    );
  }
  if (!previewClientId || operationalClients.length === 0) {
    return (
      <main className="rounded-xl border border-sand bg-white/70 p-6">
        <h1 className="font-display text-2xl text-ink">
          No client portal to preview
        </h1>
        <p className="mt-2 text-sm text-muted">
          A real client account will appear here after a won deal is handed
          over.
        </p>
      </main>
    );
  }
  if (workspace.error || !workspace.data) {
    return (
      <main className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        <p>{workspace.error?.message ?? "Client preview is unavailable."}</p>
        <Link className="underline" href="/clients">
          Back to Admin
        </Link>
      </main>
    );
  }

  const data = workspace.data;
  const approvals = data.approvals.filter(
    (approval) => !hasSyntheticMarker(approval.title),
  );
  const tasks = data.tasks.filter((task) => !hasSyntheticMarker(task.title));
  const assets = data.assets.filter(
    (asset) => !hasSyntheticMarker(asset.title),
  );
  return (
    <main className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ochre/30 bg-ochre/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            Read-only partner preview
          </p>
          <p className="text-sm text-ink">
            See exactly what this client sees without taking actions for them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Preview client portal"
            className="rounded-lg border border-ochre/30 bg-white px-3 py-2 text-sm"
            value={previewClientId}
            onChange={(event) => {
              const next = event.target.value;
              setClientId(next);
              window.history.replaceState(
                null,
                "",
                `/client-preview?client=${next}`,
              );
            }}
          >
            {operationalClients.map((client) => (
              <option key={client.clientId} value={client.clientId}>
                {client.name}
              </option>
            ))}
          </select>
          <Link href="/clients">
            <Button type="button" variant="ghost">
              ← Back to Admin
            </Button>
          </Link>
        </div>
      </div>

      <section id="approvals">
        <p className="font-display text-sm uppercase tracking-[0.2em] text-ochre">
          hrmny client workspace
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
          {data.clientName}
        </h1>
        <p className="mt-2 text-muted">
          Review the client&apos;s current work, files, and decisions below.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Deliverables</p>
          <p className="mt-1 font-display text-3xl text-ink">{tasks.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Assets</p>
          <p className="mt-1 font-display text-3xl text-ink">{assets.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Awaiting approval</p>
          <p className="mt-1 font-display text-3xl text-ink">
            {approvals.length}
          </p>
        </Card>
      </section>

      <section>
        <h2 className="font-display text-2xl text-ink">Approvals</h2>
        <div className="mt-3 space-y-3">
          {approvals.map((approval) => (
            <Card key={approval.approvalId} className="!p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-ink">{approval.title}</p>
                  <p className="mt-1 text-sm text-muted">
                    {readable(approval.kind)} · response requested within{" "}
                    {approval.slaHours}h
                  </p>
                </div>
                <p className="text-sm font-medium text-ochre">
                  Client action required in the portal
                </p>
              </div>
            </Card>
          ))}
          {approvals.length === 0 ? (
            <Card className="!p-5 text-sm text-muted">
              Nothing is waiting for approval. The current decision is reflected
              in the delivery status below.
            </Card>
          ) : null}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-xl text-ink">Delivery</h2>
          <ul className="mt-3 divide-y divide-sand text-sm">
            {tasks.map((task) => (
              <li key={task.taskId} className="flex justify-between gap-4 py-3">
                <span>{task.title}</span>
                <span className="text-ochre">{readable(task.status)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-display text-xl text-ink">Assets</h2>
          <ul className="mt-3 divide-y divide-sand text-sm">
            {assets.map((asset) => (
              <li
                key={asset.assetId}
                className="flex justify-between gap-4 py-3"
              >
                <span>{asset.title}</span>
                <span className="text-muted">
                  {readable(asset.status)} · v{asset.versionCount}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </main>
  );
}
