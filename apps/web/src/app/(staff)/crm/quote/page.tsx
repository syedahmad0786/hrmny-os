"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
  CrmTag,
} from "@/components/crm/ui";
import { formatAed } from "@/components/crm/format";

export default function CrmQuotePage() {
  const session = trpc.auth.session.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const [dealId, setDealId] = useState<string>("");

  const selected = useMemo(() => {
    const list = deals.data ?? [];
    if (dealId) return list.find((d) => d.dealId === dealId) ?? list[0];
    return (
      list.find((d) => d.stage === "propose" || d.stage === "price_cost") ??
      list[0]
    );
  }, [deals.data, dealId]);

  const marginAllowed = Boolean(session.data?.canViewMargin);
  const quote = Number(selected?.quoteValue ?? 0);
  const cost =
    marginAllowed && "internalCost" in (selected ?? {})
      ? Number((selected as { internalCost?: string | null }).internalCost ?? 0)
      : null;
  const margin =
    marginAllowed && selected && "marginPct" in selected
      ? (selected as { marginPct?: string | null }).marginPct
      : null;
  const feePct = Number(selected?.vendorHandlingFeePct ?? 20);
  const fee = Math.round((quote * feePct) / 100 / 5);

  return (
    <main>
      <CrmPageHeader
        title="Commercial panel"
        description="Scope, line items and guarded commercial logic for the current deal."
        actions={
          selected ? (
            <Link href={`/crm/deals/${selected.dealId}`}>
              <CrmBtn>Open deal</CrmBtn>
            </Link>
          ) : null
        }
      />

      {deals.isLoading ? (
        <CrmEmpty title="Loading commercial data…" />
      ) : !selected ? (
        <CrmEmpty title="No deals" hint="Create a deal before opening commercial." />
      ) : (
        <section className="crm-split">
          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Quote · {selected.companyName}</h3>
                <p>
                  {selected.dealId.slice(0, 8)} · {String(selected.stage)}
                </p>
              </div>
              <CrmTag>Live</CrmTag>
            </div>
            <div className="crm-panel-body">
              <div className="crm-field" style={{ marginBottom: 14 }}>
                <label>Active deal</label>
                <select
                  className="crm-select"
                  value={selected.dealId}
                  onChange={(e) => setDealId(e.target.value)}
                >
                  {(deals.data ?? []).map((d) => (
                    <option key={d.dealId} value={d.dealId}>
                      {d.companyName} · {d.stage}
                    </option>
                  ))}
                </select>
              </div>

              <div className="crm-table-shell">
                <div className="crm-table-scroll">
                  <table className="crm-table" style={{ minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th>Line item</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Quoted opportunity</td>
                        <td>1</td>
                        <td>{formatAed(quote)}</td>
                        <td>
                          <strong>{formatAed(quote)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td>Vendor handling fee</td>
                        <td>{feePct}%</td>
                        <td>of pass-through</td>
                        <td>
                          <strong>{formatAed(fee)}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="crm-form-grid" style={{ marginTop: 14 }}>
                <div className="crm-field">
                  <label>Discount tier</label>
                  <select className="crm-select" defaultValue="none">
                    <option value="none">None</option>
                    <option value="t1">Tier 1 · approval needed</option>
                  </select>
                </div>
                <div className="crm-field">
                  <label>Quote total</label>
                  <div className="font-display text-2xl font-semibold">
                    {formatAed(quote)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="crm-panel">
            <div className="crm-panel-head">
              <h3>Commercial controls</h3>
            </div>
            <div className="crm-panel-body">
              {marginAllowed ? (
                <>
                  <div className="crm-metric" style={{ marginBottom: 10 }}>
                    <span className="crm-metric-label">Estimated contribution</span>
                    <strong>{margin ? `${Number(margin).toFixed(1)}%` : "—"}</strong>
                    <small>After internal and vendor cost</small>
                  </div>
                  <div className="crm-checklist">
                    <div className="crm-check-row">
                      Internal cost <span>{formatAed(cost)}</span>
                    </div>
                    <div className="crm-check-row">
                      Handling fee <span>{feePct}%</span>
                    </div>
                    <div className="crm-check-row">
                      Email verified{" "}
                      <span>
                        <CrmTag kind={selected.emailVerified ? "success" : "warn"}>
                          {selected.emailVerified ? "Yes" : "No"}
                        </CrmTag>
                      </span>
                    </div>
                  </div>
                  <div className="crm-note">
                    Partner / Finance · Internal cost and contribution are visible.
                  </div>
                </>
              ) : (
                <>
                  <div className="crm-empty">
                    <strong className="block font-display text-lg">
                      Commercial cost is restricted
                    </strong>
                    <p className="mt-2">
                      Account Managers can shape scope and client price. Internal
                      cost and margin are not loaded for this role.
                    </p>
                  </div>
                  <div className="crm-note">
                    Account Manager · API omits internal_cost and margin fields.
                  </div>
                </>
              )}
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
