"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { isSyntheticRecordName } from "@/lib/synthetic-records";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTag } from "@/components/crm/ui";
import { formatAed, formatRelative } from "@/components/crm/format";

type DraftLine = {
  label: string;
  qty: string;
  unitSell: string;
  unitCost: string;
};

const TIER_LABELS: Record<string, string> = {
  am: "Tier 1 · AM authority",
  md: "Tier 2 · MD approval",
  partner: "Tier 3 · Partner approval",
};

function emptyLine(): DraftLine {
  return { label: "", qty: "1", unitSell: "0", unitCost: "0" };
}

export default function CrmQuotePage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const stages = trpc.crm.stages.useQuery();
  const [dealId, setDealId] = useState<string | null>(null);

  useEffect(() => {
    const requestedDealId = new URLSearchParams(window.location.search).get(
      "dealId",
    );
    setDealId(requestedDealId ?? "");
  }, []);

  const allDeals = deals.data ?? [];
  const dealList = allDeals.filter(
    (deal) =>
      deal.dealId === dealId || !isSyntheticRecordName(deal.companyName),
  );
  const hiddenTestCount = allDeals.length - dealList.length;
  const selected =
    dealId === null
      ? undefined
      : dealId
        ? dealList.find((d) => d.dealId === dealId)
        : (dealList.find(
            (d) => d.stage === "propose" || d.stage === "price_cost",
          ) ?? dealList[0]);
  const stageLabel = (key: string) =>
    stages.data?.find((stage) => stage.key === key)?.label ??
    key.replace(/_/g, " ");

  const versions = trpc.crm.quotes.listByDeal.useQuery(
    { dealId: selected?.dealId ?? "" },
    { enabled: Boolean(selected) },
  );
  const [viewId, setViewId] = useState<string | null>(null);
  const viewed = trpc.crm.quotes.get.useQuery(
    { id: viewId ?? "" },
    { enabled: Boolean(viewId) },
  );
  const save = trpc.crm.quotes.save.useMutation({
    onSuccess: () => void utils.crm.quotes.invalidate(),
  });
  const acceptSigned = trpc.crm.quotes.acceptSigned.useMutation({
    onSuccess: () => void utils.crm.quotes.invalidate(),
  });

  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [discount, setDiscount] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [seededDeal, setSeededDeal] = useState<string | null>(null);

  // Seed the editor from the latest saved version whenever the deal changes.
  useEffect(() => {
    if (!selected || seededDeal === selected.dealId || versions.isLoading) {
      return;
    }
    const latest = versions.data?.[0];
    if (latest) {
      setLines(
        latest.lineItems.map((li) => ({
          label: li.label,
          qty: String(li.qty ?? 1),
          unitSell: String(li.unitSell),
          unitCost: String("unitCost" in li ? li.unitCost : 0),
        })),
      );
      setDiscount(latest.discountPct ? String(Number(latest.discountPct)) : "");
    } else {
      setLines([
        {
          label: "Quoted opportunity",
          qty: "1",
          unitSell: String(Number(selected.quoteValue ?? 0) || 0),
          unitCost: "0",
        },
      ]);
      setDiscount("");
    }
    setSeededDeal(selected.dealId);
    setViewId(null);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, versions.data, versions.isLoading, seededDeal]);

  const marginAllowed = Boolean(session.data?.canViewMargin);
  const canAcceptSigned = Boolean(
    session.data?.roles.some((role) => ["partner", "director"].includes(role)),
  );

  const parsedLines = lines
    .map((l) => ({
      label: l.label.trim(),
      qty: Number(l.qty) || 1,
      unitSell: Math.max(0, Number(l.unitSell) || 0),
      unitCost: Math.max(0, Number(l.unitCost) || 0),
    }))
    .filter((l) => l.label.length > 0);
  const subtotal = parsedLines.reduce((s, l) => s + l.qty * l.unitSell, 0);
  const discountNum = Math.min(100, Math.max(0, Number(discount) || 0));
  const discountedTotal = subtotal * (1 - discountNum / 100);

  const saved = save.data?.ok === true ? save.data : null;
  const saveFailed = save.data?.ok === false ? save.data.reason : null;

  // Dead-control fix: tier reflects the server-computed approval tier —
  // from the save response first, else the latest persisted version.
  const latest = versions.data?.[0];
  const currentQuote = saved?.quote ?? latest;
  const activeQuote =
    acceptSigned.data?.quoteId === currentQuote?.quoteId
      ? acceptSigned.data
      : currentQuote;
  const currentTier = saved
    ? saved.approvalTier
    : (latest?.discountApprovalTier ?? null);

  const latestMargin =
    saved && "marginPct" in saved.quote
      ? saved.quote
      : latest && "marginPct" in latest
        ? latest
        : null;

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );

  const onSave = () => {
    if (!selected || parsedLines.length === 0) return;
    void save.mutateAsync({
      dealId: selected.dealId,
      lineItems: parsedLines,
      discountPct: discountNum > 0 ? discountNum : undefined,
    });
  };

  return (
    <main>
      <CrmPageHeader
        title="Scope & pricing"
        description="Build the client-facing scope and price. Internal cost and margin stay restricted to Partner and Finance roles."
        actions={
          selected ? (
            <Link href={`/crm/deals/${selected.dealId}`}>
              <CrmBtn>Open deal</CrmBtn>
            </Link>
          ) : null
        }
      />

      {deals.isLoading || dealId === null ? (
        <CrmEmpty title="Loading commercial data…" />
      ) : deals.isError ? (
        <CrmEmpty title="Could not load deals" hint={deals.error.message} />
      ) : !selected ? (
        <CrmEmpty
          title={dealId ? "Deal not found" : "No deals"}
          hint={
            dealId
              ? "This pricing link is stale or unavailable. Return to the pipeline and open the correct lead."
              : "Create a deal before building scope and pricing."
          }
        />
      ) : (
        <section className="crm-split">
          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Client quote · {selected.companyName}</h3>
                <p>
                  {stageLabel(String(selected.stage))}
                  {latest
                    ? ` · v${latest.version} saved`
                    : " · no versions yet"}
                </p>
              </div>
              <CrmTag kind={latest ? "success" : undefined}>
                {latest ? `v${latest.version}` : "New"}
              </CrmTag>
            </div>
            <div className="crm-panel-body">
              <div className="crm-field" style={{ marginBottom: 14 }}>
                <label>Active deal</label>
                <select
                  className="crm-select"
                  data-testid="quote-deal-select"
                  value={selected.dealId}
                  onChange={(e) => setDealId(e.target.value)}
                >
                  {dealList.map((d) => (
                    <option key={d.dealId} value={d.dealId}>
                      {d.companyName} · {stageLabel(String(d.stage))}
                    </option>
                  ))}
                </select>
                {hiddenTestCount ? (
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    {hiddenTestCount} automated test deal
                    {hiddenTestCount === 1 ? " is" : "s are"} hidden from this
                    client selector.
                  </p>
                ) : null}
              </div>

              <div className="crm-table-shell">
                <div className="crm-table-scroll">
                  <table className="crm-table" style={{ minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th>Line item</th>
                        <th>Qty</th>
                        <th>Client price (AED)</th>
                        {marginAllowed ? <th>Internal cost (AED)</th> : null}
                        <th>Total</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} data-testid="quote-line">
                          <td>
                            <input
                              className="crm-input"
                              data-testid="quote-line-label"
                              placeholder="Line item"
                              value={l.label}
                              onChange={(e) =>
                                setLine(i, { label: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="crm-input"
                              data-testid="quote-line-qty"
                              type="number"
                              min={1}
                              style={{ width: 70 }}
                              value={l.qty}
                              onChange={(e) =>
                                setLine(i, { qty: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="crm-input"
                              data-testid="quote-line-sell"
                              type="number"
                              min={0}
                              style={{ width: 110 }}
                              value={l.unitSell}
                              onChange={(e) =>
                                setLine(i, { unitSell: e.target.value })
                              }
                            />
                          </td>
                          {marginAllowed ? (
                            <td>
                              <input
                                className="crm-input"
                                data-testid="quote-line-cost"
                                type="number"
                                min={0}
                                style={{ width: 110 }}
                                value={l.unitCost}
                                onChange={(e) =>
                                  setLine(i, { unitCost: e.target.value })
                                }
                              />
                            </td>
                          ) : null}
                          <td>
                            <strong>
                              {formatAed(
                                (Number(l.qty) || 1) *
                                  (Number(l.unitSell) || 0),
                              )}
                            </strong>
                          </td>
                          <td>
                            <CrmBtn
                              variant="ghost"
                              disabled={lines.length <= 1}
                              onClick={() =>
                                setLines((prev) =>
                                  prev.filter((_, idx) => idx !== i),
                                )
                              }
                            >
                              ✕
                            </CrmBtn>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="crm-table-foot">
                  <CrmBtn
                    variant="ghost"
                    onClick={() => setLines((prev) => [...prev, emptyLine()])}
                  >
                    ＋ Add line
                  </CrmBtn>
                </div>
              </div>

              <div className="crm-form-grid" style={{ marginTop: 14 }}>
                <div className="crm-field">
                  <label>Discount %</label>
                  <input
                    className="crm-input"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </div>
                <div className="crm-field">
                  <label>Discount tier</label>
                  <div>
                    {currentTier ? (
                      <CrmTag kind={currentTier === "am" ? "success" : "warn"}>
                        {TIER_LABELS[currentTier] ?? currentTier}
                      </CrmTag>
                    ) : (
                      <CrmTag>None · save to compute</CrmTag>
                    )}
                  </div>
                </div>
                <div className="crm-field">
                  <label>Quote total</label>
                  <div className="font-display text-2xl font-semibold">
                    {formatAed(discountedTotal)}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <CrmBtn
                  variant="primary"
                  data-testid="quote-save"
                  disabled={save.isPending || parsedLines.length === 0}
                  onClick={onSave}
                >
                  {save.isPending
                    ? "Saving…"
                    : `Save version ${(latest?.version ?? 0) + 1}`}
                </CrmBtn>
              </div>

              {save.error ? (
                <div
                  className="crm-note"
                  style={{ marginTop: 10 }}
                  data-testid="quote-save-error"
                >
                  Save failed · {save.error.message}
                </div>
              ) : saveFailed ? (
                <div
                  className="crm-note"
                  style={{ marginTop: 10 }}
                  data-testid="quote-save-error"
                >
                  Save failed · {saveFailed}
                </div>
              ) : saved ? (
                <div
                  className="crm-note"
                  style={{ marginTop: 10 }}
                  data-testid="quote-save-status"
                >
                  Saved draft v{saved.quote.version} ·{" "}
                  {saved.approvalTier
                    ? (TIER_LABELS[saved.approvalTier] ?? saved.approvalTier)
                    : "No discount approval needed"}
                  {saved.escalatedTo
                    ? ` · escalated to ${saved.escalatedTo.toUpperCase()} for approval`
                    : ""}
                  {saved.marginBelowFloor
                    ? ` · margin below ${saved.floorPct}% floor (target ${saved.targetPct}%)`
                    : ""}
                </div>
              ) : null}

              {activeQuote?.status === "accepted" ? (
                <div className="crm-note" style={{ marginTop: 10 }}>
                  Signed agreement recorded for v{activeQuote.version}. The deal
                  can be marked won after it passes the commercial stage gates.
                </div>
              ) : canAcceptSigned && activeQuote ? (
                <div className="crm-form-grid" style={{ marginTop: 14 }}>
                  <div className="crm-field">
                    <label htmlFor="signed-agreement-url">
                      Signed agreement URL
                    </label>
                    <input
                      id="signed-agreement-url"
                      className="crm-input"
                      type="url"
                      placeholder="https://drive.google.com/…"
                      value={evidenceUrl}
                      onChange={(event) => setEvidenceUrl(event.target.value)}
                    />
                  </div>
                  <div className="crm-field">
                    <label>Client acceptance</label>
                    <CrmBtn
                      disabled={
                        acceptSigned.isPending ||
                        !evidenceUrl.trim().startsWith("https://")
                      }
                      onClick={() =>
                        void acceptSigned
                          .mutateAsync({
                            quoteId: activeQuote.quoteId,
                            evidenceUrl: evidenceUrl.trim(),
                          })
                          .then(() => setEvidenceUrl(""))
                      }
                    >
                      Record signed agreement
                    </CrmBtn>
                  </div>
                  {acceptSigned.error ? (
                    <div className="crm-note">{acceptSigned.error.message}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Pricing checks</h3>
                <p>Review approval level, internal cost, and margin.</p>
              </div>
            </div>
            <div className="crm-panel-body">
              {latestMargin ? (
                <>
                  <div className="crm-metric" style={{ marginBottom: 10 }}>
                    <span className="crm-metric-label">Margin</span>
                    <strong>
                      {Number(latestMargin.marginPct).toFixed(1)}%
                    </strong>
                    <small>Latest saved version</small>
                  </div>
                  <div className="crm-checklist">
                    <div className="crm-check-row">
                      Internal cost{" "}
                      <span>{formatAed(latestMargin.internalCost)}</span>
                    </div>
                    <div className="crm-check-row">
                      Quote value{" "}
                      <span>{formatAed(latestMargin.quoteValue)}</span>
                    </div>
                  </div>
                  <div className="crm-note">
                    Partner / Finance · Internal cost and margin are visible.
                  </div>
                </>
              ) : marginAllowed ? (
                <div className="crm-empty">
                  <strong className="block font-display text-lg">
                    No margin data yet
                  </strong>
                  <p className="mt-2">
                    Save a version to compute cost and margin.
                  </p>
                </div>
              ) : (
                <>
                  <div className="crm-empty">
                    <strong className="block font-display text-lg">
                      Commercial cost is restricted
                    </strong>
                    <p className="mt-2">
                      Account Managers can shape scope and client price.
                      Internal cost and margin are not loaded for this role.
                    </p>
                  </div>
                  <div className="crm-note">
                    Account Manager · API omits internal_cost and margin fields.
                  </div>
                </>
              )}

              <div className="crm-panel-head" style={{ marginTop: 16 }}>
                <h3>Version history</h3>
              </div>
              {versions.isLoading ? (
                <div className="crm-note">Loading versions…</div>
              ) : versions.isError ? (
                <div className="crm-note">
                  Could not load versions · {versions.error.message}
                </div>
              ) : (versions.data ?? []).length === 0 ? (
                <div className="crm-note">
                  No saved versions yet — save the first one.
                </div>
              ) : (
                <div className="crm-checklist">
                  {(versions.data ?? []).map((q) => (
                    <div className="crm-check-row" key={q.quoteId}>
                      <span>
                        v{q.version} · {q.status}
                        {q.discountPct ? ` · −${Number(q.discountPct)}%` : ""}
                        {"marginPct" in q
                          ? ` · ${Number(q.marginPct).toFixed(1)}% margin`
                          : ""}
                      </span>
                      <span>
                        {formatAed(q.quoteValue)} ·{" "}
                        {formatRelative(q.createdAt)}{" "}
                        <CrmBtn
                          variant="ghost"
                          onClick={() =>
                            setViewId(viewId === q.quoteId ? null : q.quoteId)
                          }
                        >
                          {viewId === q.quoteId ? "Hide" : "View"}
                        </CrmBtn>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {viewId ? (
                viewed.isLoading ? (
                  <div className="crm-note" style={{ marginTop: 10 }}>
                    Loading version…
                  </div>
                ) : viewed.isError ? (
                  <div className="crm-note" style={{ marginTop: 10 }}>
                    Could not load version · {viewed.error.message}
                  </div>
                ) : viewed.data ? (
                  <div className="crm-table-shell" style={{ marginTop: 10 }}>
                    <div className="crm-table-scroll">
                      <table className="crm-table">
                        <thead>
                          <tr>
                            <th>v{viewed.data.version} line item</th>
                            <th>Qty</th>
                            <th>Sell</th>
                            {"marginPct" in viewed.data ? <th>Cost</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {viewed.data.lineItems.map((li, i) => (
                            <tr key={i}>
                              <td>{li.label}</td>
                              <td>{li.qty ?? 1}</td>
                              <td>{formatAed(li.unitSell)}</td>
                              {"marginPct" in viewed.data! ? (
                                <td>
                                  {"unitCost" in li
                                    ? formatAed(Number(li.unitCost))
                                    : "—"}
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="crm-table-foot">
                      <CrmBtn
                        onClick={() => {
                          const q = viewed.data;
                          if (!q) return;
                          setLines(
                            q.lineItems.map((li) => ({
                              label: li.label,
                              qty: String(li.qty ?? 1),
                              unitSell: String(li.unitSell),
                              unitCost: String(
                                "unitCost" in li ? li.unitCost : 0,
                              ),
                            })),
                          );
                          setDiscount(
                            q.discountPct ? String(Number(q.discountPct)) : "",
                          );
                        }}
                      >
                        Load into editor
                      </CrmBtn>
                    </div>
                  </div>
                ) : (
                  <div className="crm-note" style={{ marginTop: 10 }}>
                    Version not found.
                  </div>
                )
              ) : null}
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
