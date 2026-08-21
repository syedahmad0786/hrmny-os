"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import { deliveryRhythmFor } from "@/lib/delivery-rhythm";
import Link from "next/link";

export default function DeliveryBoardPage() {
  const utils = trpc.useUtils();
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const board = trpc.dashboards.delivery.useQuery();
  const capacity = trpc.dashboards.capacity.useQuery();
  const clients = trpc.clients.list.useQuery();
  const demoResets = showDemoResets();
  const rhythms = (clients.data ?? []).slice(0, 8).map((c) => ({
    name: c.name,
    ...deliveryRhythmFor(c.engagementType),
  }));

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            Delivery board
          </h1>
          <p className="text-muted">
            Task board · retainer = recurring checkpoints · project = milestone
            touchpoints
          </p>
        </div>
        {demoResets ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void reset.mutateAsync()}
            disabled={reset.isPending}
          >
            Reset M4 demo
          </Button>
        ) : null}
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <p className="text-sm font-medium">Contract → delivery rhythm</p>
        <ul className="mt-2 space-y-1 text-sm">
          {rhythms.map((row) => (
            <li key={row.name}>
              <span className="font-medium">{row.name}</span>
              {" — "}
              {row.label}
            </li>
          ))}
          {!rhythms.length ? (
            <li className="text-muted">
              No clients yet — set engagement type on{" "}
              <Link href="/clients" className="underline">
                Clients
              </Link>
              .
            </li>
          ) : null}
        </ul>
      </section>

      <p className="text-sm text-muted">
        Bottleneck:{" "}
        <span className="text-ink">
          {board.data?.bottleneck.status ?? "—"} (
          {board.data?.bottleneck.count ?? 0}) · ratio{" "}
          {board.data?.ratio ?? 0}
        </span>
        {" · "}
        <Link href="/traffic" className="text-ochre underline">
          Traffic / DoR
        </Link>
        {" · "}
        <Link href="/creative" className="text-ochre underline">
          Creative QC
        </Link>
        {" · "}
        <Link href="/account" className="text-ochre underline">
          Account rhythm
        </Link>
        {" · "}
        <Link href="/assets" className="text-ochre underline">
          Assets
        </Link>
      </p>

      <section className="overflow-x-auto">
        <div className="flex min-w-max gap-3">
          {(board.data?.board ?? []).map((col) => (
            <div
              key={col.status}
              className="w-44 shrink-0 rounded-lg border border-sand bg-white/70 p-3"
            >
              <p className="font-display text-xs uppercase tracking-wider text-ochre">
                {col.status.replace(/_/g, " ")}
              </p>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {col.tasks.map((t) => (
                  <li
                    key={t.taskId}
                    className="rounded border border-sand/70 bg-paper/80 px-2 py-1.5"
                  >
                    <p className="font-medium leading-snug">{t.title}</p>
                    <p className="text-xs text-muted">
                      {t.priority ?? "—"} · {t.taskType}
                    </p>
                  </li>
                ))}
                {col.tasks.length === 0 ? (
                  <li className="text-xs text-muted">Empty</li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Capacity (3 weeks)</h2>
        <ul className="mt-2 grid gap-2 text-sm md:grid-cols-3">
          {(capacity.data?.weeks ?? []).map((w) => (
            <li key={w.weekStart} className="border-t border-sand/60 pt-2">
              <p className="font-medium">{w.weekStart}</p>
              <p className="text-muted">
                assigned {w.assigned} · unassigned {w.unassigned} · in prod{" "}
                {w.inProduction}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
