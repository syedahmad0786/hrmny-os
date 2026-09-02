"use client";

import { trpc } from "@/lib/trpc";
import { hasSyntheticMarker } from "@/lib/synthetic-records";
import { PortalAssetPreview } from "../portal-asset-preview";

export default function PortalDeliveriesPage() {
  const rows = trpc.portal.deliveries.list.useQuery();
  const deliveries = (rows.data ?? [])
    .map((delivery) => ({
      ...delivery,
      deliverables: delivery.deliverables.filter(
        (item) => !hasSyntheticMarker(item.title),
      ),
    }))
    .filter((delivery) => delivery.deliverables.length > 0);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Your work
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-ink">
          Deliveries
        </h1>
        <p className="mt-2 text-muted">
          Follow work in progress and open completed files when they are ready.
        </p>
      </div>
      {deliveries.map((delivery) => (
        <section
          key={delivery.clientId}
          className="space-y-4 rounded-xl border border-[#D9D0C4] bg-white/70 p-5"
        >
          <p className="text-sm font-medium text-ink">
            Status:{" "}
            <span className="capitalize text-ochre">
              {delivery.deliveryStatus.replaceAll("_", " ")}
            </span>
          </p>
          <ul className="space-y-4 text-sm text-muted">
            {delivery.deliverables.map((item) => (
              <li
                key={`${item.kind}-${item.taskId}`}
                className="border-t border-[#D9D0C4] pt-4 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{item.title}</span>
                  <span className="capitalize text-xs">
                    {item.status.replaceAll("_", " ")}
                  </span>
                </div>
                {item.kind === "asset" && item.taskId ? (
                  <PortalAssetPreview
                    assetId={item.taskId}
                    title={item.title}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!rows.isLoading && deliveries.length === 0 ? (
        <p className="rounded-xl border border-[#D9D0C4] bg-white/70 p-5 text-sm text-muted">
          No deliveries are ready yet. New work will appear here automatically.
        </p>
      ) : null}
    </main>
  );
}
