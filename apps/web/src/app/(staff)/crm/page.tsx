"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmFilterBar,
  CrmPageHeader,
  CrmTag,
} from "@/components/crm/ui";
import {
  LANE_LABELS,
  formatAed,
  formatLane,
  formatRelative,
  initials,
  tagKindForTemp,
} from "@/components/crm/format";
import { DemoReadinessPanel } from "@/components/demo-readiness-panel";
import { DashStrip } from "./_components/dash-strip";
import { isSyntheticRecordName } from "@/lib/synthetic-records";

export default function CrmPipelinePage() {
  const utils = trpc.useUtils();
  const stages = trpc.crm.stages.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const health = trpc.crm.health.useQuery();
  const create = trpc.crm.deals.create.useMutation({
    onSuccess: () => void utils.crm.deals.invalidate(),
  });
  const move = trpc.crm.deals.moveStage.useMutation({
    onSuccess: () => void utils.crm.deals.invalidate(),
  });

  const [search, setSearch] = useState("");
  const [lane, setLane] = useState("all");
  const [temp, setTemp] = useState("all");
  const [companyName, setCompanyName] = useState("");
  const [showTestRecords, setShowTestRecords] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  /** Move a deal; surface gate rejections (moveStage returns ok:false, it
   * does not throw). No optimistic update, so a blocked move never moves the
   * card — the refetch confirms server state. */
  const handleMove = async (id: string, to: string) => {
    if (move.isPending) return;
    try {
      const res = await move.mutateAsync({ id, to });
      if (!res.ok) {
        setMoveError(
          res.blockedBy?.map((b) => `${b.gate}: ${b.reason}`).join(" · ") ??
            res.reason ??
            "Move blocked",
        );
      } else {
        setMoveError(null);
      }
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Move failed");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (deals.data ?? []).filter((d) => {
      if (!showTestRecords && isSyntheticRecordName(d.companyName))
        return false;
      if (lane !== "all" && d.leadSourceLane !== lane) return false;
      if (temp !== "all" && (d.buafTemperature ?? "") !== temp) return false;
      if (!q) return true;
      return (
        d.companyName.toLowerCase().includes(q) ||
        (d.sector ?? "").toLowerCase().includes(q) ||
        formatLane(d.leadSourceLane).toLowerCase().includes(q)
      );
    });
  }, [deals.data, search, lane, temp, showTestRecords]);

  const hiddenTestCount = (deals.data ?? []).filter((deal) =>
    isSyntheticRecordName(deal.companyName),
  ).length;

  const stageList = stages.data ?? [];

  return (
    <main>
      <CrmPageHeader
        title="Pipeline"
        description="See every active opportunity, who owns it, and the next stage it needs to reach."
        actions={
          <>
            <CrmBtn
              onClick={() => {
                const name = companyName.trim();
                if (!name) return;
                void create.mutateAsync({
                  companyName: name,
                  leadSourceLane: "relationship_led",
                });
                setCompanyName("");
              }}
              disabled={create.isPending || !companyName.trim()}
              variant="primary"
            >
              ＋ Create deal
            </CrmBtn>
          </>
        }
      />

      <details className="mb-4 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-ink">
          Sales setup
        </summary>
        <div className="mt-3">
          <DemoReadinessPanel testIdPrefix="crm" />
        </div>
      </details>

      <CrmFilterBar>
        <input
          placeholder="Search deals or companies"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          placeholder="New company name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
        <select value={lane} onChange={(e) => setLane(e.target.value)}>
          <option value="all">All lanes</option>
          {Object.entries(LANE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select value={temp} onChange={(e) => setTemp(e.target.value)}>
          <option value="all">All temperatures</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cool">Cool</option>
          <option value="cold">Cold</option>
        </select>
        <div className="crm-view-switch">
          <Link href="/crm" className="active">
            Board
          </Link>
          <Link href="/crm/deals">List</Link>
        </div>
      </CrmFilterBar>

      {hiddenTestCount ? (
        <label className="mb-3 flex w-fit items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showTestRecords}
            onChange={(event) => setShowTestRecords(event.target.checked)}
          />
          {showTestRecords ? "Hide" : "Show"} {hiddenTestCount} test record
          {hiddenTestCount === 1 ? "" : "s"}
        </label>
      ) : null}

      <p className="mb-3 text-[11px] text-[var(--muted)]">
        {health.isError ? "Pipeline unavailable" : "Pipeline up to date"} ·{" "}
        {filtered.length} active deal{filtered.length === 1 ? "" : "s"}
      </p>

      <DashStrip />

      {moveError ? (
        <div
          className="crm-note mb-4 flex items-center justify-between gap-3"
          role="alert"
        >
          <span>Stage move blocked — {moveError}</span>
          <CrmBtn variant="ghost" onClick={() => setMoveError(null)}>
            Dismiss
          </CrmBtn>
        </div>
      ) : null}

      {deals.isLoading ? (
        <CrmEmpty title="Loading pipeline…" />
      ) : (
        <div className="crm-board-wrap">
          <div className="crm-board">
            {stageList.map((stage) => {
              const col = filtered.filter((d) => d.stage === stage.key);
              return (
                <section
                  key={stage.key}
                  className={`crm-column${dragOver === stage.key ? " drag-over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(stage.key);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = dragId ?? e.dataTransfer.getData("text/deal-id");
                    setDragId(null);
                    if (!id) return;
                    void handleMove(id, stage.key);
                  }}
                >
                  <div className="crm-column-head">
                    <strong>{stage.label}</strong>
                    <span>{col.length}</span>
                  </div>
                  {col.map((d) => {
                    const tempVal = d.buafTemperature ?? undefined;
                    return (
                      <Link
                        key={d.dealId}
                        href={`/crm/deals/${d.dealId}`}
                        className="crm-deal-card"
                        draggable
                        onDragStart={(e) => {
                          setDragId(d.dealId);
                          e.dataTransfer.setData("text/deal-id", d.dealId);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <div className="crm-deal-top">
                          <span className={`crm-temp-dot ${tempVal ?? ""}`} />
                          {tempVal ? (
                            <CrmTag kind={tagKindForTemp(tempVal)}>
                              {tempVal}
                            </CrmTag>
                          ) : (
                            <CrmTag kind="info">No priority</CrmTag>
                          )}
                        </div>
                        <h4>{d.sector ?? "Opportunity"}</h4>
                        <span className="company">{d.companyName}</span>
                        <div className="crm-deal-value">
                          {formatAed(d.quoteValue)}
                        </div>
                        <div className="crm-deal-meta">
                          <span>{formatLane(d.leadSourceLane)}</span>
                          <span className="crm-initials">
                            {initials(d.ownerEmployeeId ? "AM" : "CH")}
                          </span>
                        </div>
                        <div
                          className="crm-deal-meta"
                          style={{ border: 0, paddingTop: 7 }}
                        >
                          <span>Updated {formatRelative(d.updatedAt)}</span>
                          <span>Open →</span>
                        </div>
                        <select
                          aria-label={`Move ${d.companyName} to stage`}
                          className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-[var(--paper-2)] px-1.5 py-1 text-[10px] text-[var(--muted)]"
                          value={d.stage}
                          disabled={move.isPending}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onChange={(e) => {
                            e.preventDefault();
                            void handleMove(d.dealId, e.target.value);
                          }}
                        >
                          {stageList.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </Link>
                    );
                  })}
                  {col.length === 0 ? (
                    <div className="px-2 py-6 text-center text-[10px] text-[var(--muted)]">
                      Drop a deal here
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
