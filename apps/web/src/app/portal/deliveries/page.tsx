"use client";

import { trpc } from "@/lib/trpc";

export default function PortalDeliveriesPage() {
  const rows = trpc.portal.deliveries.list.useQuery();

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-ink">Deliveries</h1>
      <p className="text-muted">Your deliverables only — no cost or margin fields.</p>
      {(rows.data ?? []).map((d) => (
        <div key={d.clientId} className="space-y-3">
          <p className="text-sm">
            Pipeline: <span className="text-ochre">{d.deliveryStatus}</span>
          </p>
          <ul className="space-y-2 text-sm text-muted">
            {d.deliverables.map((item) => (
              <li key={item.taskId}>
                {item.title} · {item.status}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </main>
  );
}
