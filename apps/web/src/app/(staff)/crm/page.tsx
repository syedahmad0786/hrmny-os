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
  formatAed,
  formatLane,
  formatRelative,
  initials,
  tagKindForTemp,
} from "@/components/crm/format";
import { usePageTitle } from "@/components/use-page-title";

export default function CrmPipelinePage() {
  usePageTitle("Pipeline");
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
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (deals.data ?? []).filter((d) => {
      if (lane !== "all" && d.leadSourceLane !== lane) return false;
      if (temp !== "all" && (d.buafTemperature ?? "") !== temp) return false;
      if (!q) return true;
      return (
        d.companyName.toLowerCase().includes(q) ||
        (d.sector ?? "").toLowerCase().includes(q) ||
        formatLane(d.leadSourceLane).toLowerCase().includes(q)
      );
    });
  }, [deals.data, search, lane, temp]);

  const stageList = stages.data ?? [];

  return (
    <main>
      <CrmPageHeader
        kicker="Pipeline"
        title="Move deals forward"
        description="Drag opportunities through guarded stages — from first signal to handover. Create a deal when a new prospect appears."
        actions={
          <>
            <CrmBtn
              onClick={() => {
                const name = companyName.trim() || "New prospect";
                void create.mutateAsync({
                  companyName: name,
                  leadSourceLane: "relationship_led",
                });
                setCompanyName("");
              }}
              disabled={create.isPending}
              variant="primary"
            >
              ＋ Create deal
            </CrmBtn>
          </>
        }
      />

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
          <option value="relationship_led">Relationship led</option>
          <option value="apollo_intent">Apollo intent</option>
          <option value="industry_scanning">Industry scanning</option>
          <option value="tejari">Tejari</option>
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

      <p className="mb-3 text-[11px] text-[var(--muted)]">
        Live CRM · mode {health.data?.mode ?? "…"} · {filtered.length} deals shown
      </p>

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
                    if (!id) return;
                    void move.mutateAsync({ id, to: stage.key });
                    setDragId(null);
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
                            <CrmTag kind={tagKindForTemp(tempVal)}>{tempVal}</CrmTag>
                          ) : (
                            <CrmTag kind="info">unset</CrmTag>
                          )}
                        </div>
                        <h4>{d.sector ?? "Opportunity"}</h4>
                        <span className="company">{d.companyName}</span>
                        <div className="crm-deal-value">{formatAed(d.quoteValue)}</div>
                        <div className="crm-deal-meta">
                          <span>{formatLane(d.leadSourceLane)}</span>
                          <span className="crm-initials">
                            {initials(d.ownerEmployeeId ? "AM" : "CH")}
                          </span>
                        </div>
                        <div className="crm-deal-meta" style={{ border: 0, paddingTop: 7 }}>
                          <span>Updated {formatRelative(d.updatedAt)}</span>
                          <span>Open →</span>
                        </div>
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
