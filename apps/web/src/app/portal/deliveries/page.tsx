"use client";

import { trpc } from "@/lib/trpc";
import { PortalAssetPreview } from "../portal-asset-preview";

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
          <ul className="space-y-4 text-sm text-muted">
            {d.deliverables.map((item) => (
              <li key={`${item.kind}-${item.taskId}`}>
                <div>
                  {item.kind === "asset" ? "Asset · " : ""}
                  {item.title} · {item.status}
                </div>
                {item.kind === "asset" && item.taskId ? (
                  <PortalAssetPreview assetId={item.taskId} title={item.title} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </main>
  );
}
