"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function DashboardsHubPage() {
  const hub = trpc.dashboards.hub.useQuery();
  const seams = trpc.seams.list.useQuery({ limit: 8 });

  return (
    <main className="flex flex-col gap-8">
      <div>
        <p className="font-display text-sm uppercase tracking-[0.2em] text-ochre">
          Milestone 6 · One OS
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
          Dashboards hub
        </h1>
        <p className="mt-3 max-w-xl text-muted">
          Five system views — each card links into the owning module. Money
          margin link only when your role allows.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(hub.data?.systems ?? []).map((sys) => (
          <Link
            key={sys.key}
            href={sys.href}
            className="block border-b border-sand pb-4 transition hover:border-ochre"
          >
            <h2 className="font-display text-xl text-ink">{sys.title}</h2>
            <p className="mt-1 text-sm text-muted">{sys.summary}</p>
            {"marginHref" in sys && sys.marginHref && (
              <span className="mt-2 inline-block text-sm text-ochre">
                + Margin →
              </span>
            )}
          </Link>
        ))}
      </section>

      <section>
        <h2 className="font-display text-lg text-ink">Recent seams</h2>
        <p className="text-sm text-muted">
          Outbox ({hub.data?.seamsQueued ?? 0}) — idempotent Inngest-style stub
        </p>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          {(seams.data ?? []).map((e) => (
            <li key={e.eventId}>
              <span className="text-ochre">{e.name}</span> · {e.idempotencyKey}
            </li>
          ))}
          {!seams.data?.length && <li>No seams fired yet — lock a brief or QC pass</li>}
        </ul>
      </section>

      <p className="text-sm text-muted">
        Client portal: pick a client on{" "}
        <Link className="text-ochre underline" href="/clients">
          /clients
        </Link>{" "}
        then use Portal approvals
        {" · "}
        Cutover notes: see <code className="text-ink">CUTOVER.md</code>
      </p>
    </main>
  );
}
