"use client";

import Link from "next/link";
import { Button, Card } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

const readable = (value: string) => value.replaceAll("_", " ");

export default function ClientPreviewPage() {
  const utils = trpc.useUtils();
  const workspace = trpc.clientPreview.workspace.useQuery();
  const act = trpc.clientPreview.act.useMutation({
    onSuccess: () => void utils.clientPreview.workspace.invalidate(),
  });

  if (workspace.isLoading) {
    return <main className="py-12 text-center text-muted">Loading client preview…</main>;
  }
  if (workspace.error || !workspace.data) {
    return (
      <main className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        <p>{workspace.error?.message ?? "Client preview is unavailable."}</p>
        <Link className="underline" href="/">
          Back to Admin
        </Link>
      </main>
    );
  }

  const data = workspace.data;
  return (
    <main className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ochre/30 bg-ochre/10 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            Secure partner preview
          </p>
          <p className="text-sm text-ink">
            This is exactly what the client can review. Finance fields are excluded.
          </p>
        </div>
        <Link href="/">
          <Button type="button" variant="ghost">
            ← Back to Admin
          </Button>
        </Link>
      </div>

      <section>
        <p className="font-display text-sm uppercase tracking-[0.2em] text-ochre">
          hrmny client workspace
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
          {data.clientName}
        </h1>
        <p className="mt-2 text-muted">
          Delivery is <strong className="text-ink">{data.delivery.deliveryStatus}</strong>.
          Review briefs, current work, assets, and approvals below.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Deliverables</p>
          <p className="mt-1 font-display text-3xl text-ink">{data.tasks.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Assets</p>
          <p className="mt-1 font-display text-3xl text-ink">{data.assets.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Awaiting approval</p>
          <p className="mt-1 font-display text-3xl text-ink">{data.approvals.length}</p>
        </Card>
      </section>

      <section>
        <h2 className="font-display text-2xl text-ink">Approvals</h2>
        <div className="mt-3 space-y-3">
          {data.approvals.map((approval) => (
            <Card key={approval.approvalId} className="!p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-ink">{approval.title}</p>
                  <p className="mt-1 text-sm text-muted">
                    {readable(approval.kind)} · response requested within {approval.slaHours}h
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({ id: approval.approvalId, action: "approve" })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({
                        id: approval.approvalId,
                        action: "reject",
                        feedback: "Needs revision",
                      })
                    }
                  >
                    Request changes
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          {data.approvals.length === 0 ? (
            <Card className="!p-5 text-sm text-muted">
              Nothing is waiting for approval. The current decision is reflected in
              the delivery status below.
            </Card>
          ) : null}
          {act.error ? <p className="text-sm text-red-700">{act.error.message}</p> : null}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-xl text-ink">Delivery</h2>
          <ul className="mt-3 divide-y divide-sand text-sm">
            {data.tasks.map((task) => (
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
            {data.assets.map((asset) => (
              <li key={asset.assetId} className="flex justify-between gap-4 py-3">
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
