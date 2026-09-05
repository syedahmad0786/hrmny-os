"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  formatContactName,
  formatAed,
  formatLane,
  tagKindForTemp,
  workEmailState,
} from "@/components/crm/format";
import { DemoReadinessPanel } from "@/components/demo-readiness-panel";
import { DashStrip } from "./_components/dash-strip";
import { isSyntheticDeal } from "@/lib/synthetic-records";
import { CRM_MARKETS } from "@/lib/crm-markets";
import {
  DEFAULT_PIPELINE_FILTERS,
  isArchived,
  parseSavedPipelineViews,
  retentionLabel,
  type PipelineFilters,
  type PipelineRecordView,
  type SavedPipelineView,
} from "./pipeline-views";

const SAVED_VIEWS_KEY = "hrmny.crm.pipeline-views.v1";

export default function CrmPipelinePage() {
  const utils = trpc.useUtils();
  const stages = trpc.crm.stages.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const companies = trpc.crm.companies.list.useQuery();
  const contacts = trpc.crm.contacts.list.useQuery();
  const tasks = trpc.crm.tasks.list.useQuery();
  const activities = trpc.crm.activities.list.useQuery({ limit: 200 });
  const session = trpc.auth.session.useQuery();
  const health = trpc.crm.health.useQuery();
  const funnel = trpc.salesOs.funnel.useQuery();
  const create = trpc.crm.deals.create.useMutation({
    onSuccess: () => void utils.crm.deals.invalidate(),
  });
  const move = trpc.crm.deals.moveStage.useMutation({
    onSuccess: () => void utils.crm.deals.invalidate(),
  });

  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [temp, setTemp] = useState("all");
  const [market, setMarket] = useState("all");
  const [owner, setOwner] = useState("all");
  const [records, setRecords] = useState<PipelineRecordView>("active");
  const [savedViews, setSavedViews] = useState<SavedPipelineView[]>([]);
  const [savedViewId, setSavedViewId] = useState("");
  const [savedViewName, setSavedViewName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [showTestRecords, setShowTestRecords] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const contactById = useMemo(
    () =>
      new Map(
        (contacts.data ?? []).map((contact) => [contact.contactId, contact]),
      ),
    [contacts.data],
  );
  const companyById = useMemo(
    () =>
      new Map(
        (companies.data ?? []).map((company) => [company.companyId, company]),
      ),
    [companies.data],
  );

  useEffect(() => {
    setSavedViews(
      parseSavedPipelineViews(window.localStorage.getItem(SAVED_VIEWS_KEY)),
    );
  }, []);

  const currentFilters = (): PipelineFilters => ({
    search,
    source,
    temperature: temp,
    market,
    owner,
    records,
  });
  const applyFilters = (filters: PipelineFilters) => {
    setSearch(filters.search);
    setSource(filters.source);
    setTemp(filters.temperature);
    setMarket(filters.market);
    setOwner(filters.owner);
    setRecords(filters.records);
  };
  const persistViews = (views: SavedPipelineView[]) => {
    setSavedViews(views);
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  };

  /** Move a deal; surface gate rejections (moveStage returns ok:false, it
   * does not throw). No optimistic update, so a blocked move never moves the
   * card — the refetch confirms server state. */
  const handleMove = async (id: string, to: string) => {
    if (move.isPending) return;
    try {
      const res = await move.mutateAsync({ id, to });
      if (!res.ok) {
        setMoveErrors((current) => ({
          ...current,
          [id]:
            res.blockedBy?.map((b) => b.reason).join(" · ") ??
            res.reason ??
            "Complete the missing requirement first.",
        }));
      } else {
        setMoveErrors((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
    } catch (err) {
      setMoveErrors((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : "Move failed",
      }));
    }
  };

  const nextTaskByDeal = useMemo(() => {
    const rows = (tasks.data ?? [])
      .filter(
        (task) =>
          task.dealId && task.status !== "done" && task.status !== "cancelled",
      )
      .sort((a, b) => {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
    const byDeal = new Map<string, (typeof rows)[number]>();
    rows.forEach((task) => {
      if (task.dealId && !byDeal.has(task.dealId))
        byDeal.set(task.dealId, task);
    });
    return byDeal;
  }, [tasks.data]);

  const stageEnteredAtByDeal = useMemo(() => {
    const byDeal = new Map<string, string>();
    (activities.data ?? []).forEach((activity) => {
      if (
        activity.dealId &&
        activity.type === "stage_change" &&
        !byDeal.has(activity.dealId)
      ) {
        byDeal.set(activity.dealId, activity.createdAt);
      }
    });
    return byDeal;
  }, [activities.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (deals.data ?? []).filter((d) => {
      if (!showTestRecords && isSyntheticDeal(d)) return false;
      if (records === "active" && d.closeOutcome) return false;
      if (
        records === "retention" &&
        (!d.closeOutcome || isArchived(d.updatedAt))
      )
        return false;
      if (
        records === "archive" &&
        (!d.closeOutcome || !isArchived(d.updatedAt))
      )
        return false;
      if (source !== "all" && d.leadSourceLane !== source) return false;
      if (temp !== "all" && (d.buafTemperature ?? "") !== temp) return false;
      if (
        market !== "all" &&
        companyById.get(d.companyId ?? "")?.market !== market
      )
        return false;
      if (owner !== "all" && (d.ownerEmployeeId ?? "unassigned") !== owner)
        return false;
      if (!q) return true;
      const leadName = formatContactName(
        d.primaryContactId ? contactById.get(d.primaryContactId) : null,
      );
      return (
        d.companyName.toLowerCase().includes(q) ||
        (leadName ?? "").toLowerCase().includes(q) ||
        (d.sector ?? "").toLowerCase().includes(q) ||
        formatLane(d.leadSourceLane).toLowerCase().includes(q)
      );
    });
  }, [
    companyById,
    contactById,
    deals.data,
    market,
    owner,
    records,
    search,
    showTestRecords,
    source,
    temp,
  ]);

  const hiddenTestCount = (deals.data ?? []).filter((deal) =>
    isSyntheticDeal(deal),
  ).length;

  const stageList = stages.data ?? [];
  const sourceOptions = Array.from(
    new Set([
      ...Object.keys(LANE_LABELS),
      ...(funnel.data?.options.campaigns ?? []),
    ]),
  );
  const loadError = deals.error ?? stages.error ?? companies.error;
  const resetFilters = () => {
    applyFilters(DEFAULT_PIPELINE_FILTERS);
    setSavedViewId("");
  };
  const saveCurrentView = () => {
    const name = savedViewName.trim();
    if (!name) return;
    const existing = savedViews.find(
      (view) => view.name.toLowerCase() === name.toLowerCase(),
    );
    const view: SavedPipelineView = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      filters: currentFilters(),
    };
    persistViews([...savedViews.filter((item) => item.id !== view.id), view]);
    setSavedViewId(view.id);
    setSavedViewName("");
  };

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
        <select
          aria-label="Record view"
          value={records}
          onChange={(e) => setRecords(e.target.value as PipelineRecordView)}
        >
          <option value="active">Active pipeline</option>
          <option value="retention">Closed — first 90 days</option>
          <option value="archive">Archive — 90+ days</option>
          <option value="all">All records</option>
        </select>
        <select
          aria-label="Campaign or source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="all">All campaigns / sources</option>
          {sourceOptions.map((value) => (
            <option key={value} value={value}>
              {formatLane(value)}
            </option>
          ))}
        </select>
        <select
          aria-label="Temperature"
          value={temp}
          onChange={(e) => setTemp(e.target.value)}
        >
          <option value="all">All temperatures</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cool">Cool</option>
          <option value="cold">Cold</option>
        </select>
        <select
          aria-label="Market"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
        >
          <option value="all">All markets</option>
          {CRM_MARKETS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="all">All owners</option>
          {(funnel.data?.options.owners ?? []).map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
          {funnel.isLoading ? (
            <option disabled>Loading owners…</option>
          ) : funnel.isError ? (
            <option disabled>Owner options unavailable</option>
          ) : null}
        </select>
        <div className="crm-view-switch">
          <Link href="/crm" className="active">
            Board
          </Link>
          <Link href="/crm/deals">List</Link>
        </div>
      </CrmFilterBar>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-white p-3">
        <label className="crm-field min-w-[190px]">
          <span>Personal saved view</span>
          <select
            data-testid="pipeline-saved-view"
            value={savedViewId}
            onChange={(event) => {
              const id = event.target.value;
              setSavedViewId(id);
              const view = savedViews.find((item) => item.id === id);
              if (view) applyFilters(view.filters);
            }}
          >
            <option value="">Choose a saved view</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
        <label className="crm-field min-w-[190px]">
          <span>Save current filters as</span>
          <input
            data-testid="pipeline-view-name"
            placeholder="e.g. My UAE prospects"
            value={savedViewName}
            onChange={(event) => setSavedViewName(event.target.value)}
          />
        </label>
        <CrmBtn
          data-testid="pipeline-save-view"
          disabled={!savedViewName.trim()}
          onClick={saveCurrentView}
        >
          Save view
        </CrmBtn>
        <CrmBtn onClick={resetFilters}>Clear filters</CrmBtn>
        {savedViewId ? (
          <CrmBtn
            onClick={() => {
              persistViews(
                savedViews.filter((view) => view.id !== savedViewId),
              );
              resetFilters();
            }}
          >
            Delete saved view
          </CrmBtn>
        ) : null}
        <span className="text-[10px] text-[var(--muted)]">
          Saved in this browser, for you only.
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="crm-field min-w-[220px]">
          <span>New company</span>
          <input
            placeholder="Company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </label>
      </div>

      {hiddenTestCount ? (
        <label className="mb-3 flex min-h-11 w-fit items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="size-5"
            checked={showTestRecords}
            onChange={(event) => setShowTestRecords(event.target.checked)}
          />
          {showTestRecords ? "Hide" : "Show"} {hiddenTestCount} test record
          {hiddenTestCount === 1 ? "" : "s"}
        </label>
      ) : null}

      <p className="mb-3 text-[11px] text-[var(--muted)]">
        {health.isError ? "Pipeline unavailable" : "Pipeline up to date"} ·{" "}
        {filtered.length} visible record{filtered.length === 1 ? "" : "s"}
        {records === "retention"
          ? " · Closed records stay here for 90 days after their latest update."
          : records === "archive"
            ? " · Closed records move here after 90 days; nothing is deleted."
            : ""}
      </p>

      <DashStrip />

      {deals.isLoading || stages.isLoading || companies.isLoading ? (
        <CrmEmpty title="Loading pipeline…" />
      ) : loadError ? (
        <CrmEmpty
          title="Pipeline could not load"
          hint={`${loadError.message} Refresh the page or try again shortly.`}
        />
      ) : filtered.length === 0 ? (
        <CrmEmpty
          title={
            records === "archive"
              ? "No closed deals match this archive view"
              : records === "retention"
                ? "No recently closed deals match this view"
                : "No deals match these filters"
          }
          hint="Clear the filters or choose another saved view."
        />
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
                    <div>
                      <strong>{stage.label}</strong>
                      <small>{stage.description}</small>
                    </div>
                    <span>{col.length}</span>
                  </div>
                  {col.map((d) => {
                    const tempVal = d.buafTemperature ?? undefined;
                    const contact = d.primaryContactId
                      ? contactById.get(d.primaryContactId)
                      : undefined;
                    const leadName = formatContactName(contact);
                    const email = workEmailState(contact, d.emailVerified);
                    const stageIndex = stageList.findIndex(
                      (item) => item.key === d.stage,
                    );
                    const nextStage = stageList[stageIndex + 1];
                    const nextTask = nextTaskByDeal.get(d.dealId);
                    const stageEnteredAt =
                      stageEnteredAtByDeal.get(d.dealId) ?? d.createdAt;
                    const daysInStage = Math.max(
                      0,
                      Math.floor(
                        (Date.now() - new Date(stageEnteredAt).getTime()) /
                          86_400_000,
                      ),
                    );
                    const taskOwner = nextTask?.ownerEmployeeId
                      ? nextTask.ownerEmployeeId === session.data?.employeeId
                        ? "You"
                        : "Assigned"
                      : "Unassigned";
                    return (
                      <article
                        key={d.dealId}
                        className="crm-deal-card"
                        draggable
                        onDragStart={(e) => {
                          setDragId(d.dealId);
                          e.dataTransfer.setData("text/deal-id", d.dealId);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <Link
                          href={`/crm/deals/${d.dealId}`}
                          className="block text-inherit no-underline"
                        >
                          <div className="crm-deal-top">
                            <span className={`crm-temp-dot ${tempVal ?? ""}`} />
                            {d.closeOutcome ? (
                              <CrmTag kind="info">
                                {d.closeOutcome.replace(/_/g, " ")}
                              </CrmTag>
                            ) : null}
                            {tempVal ? (
                              <CrmTag kind={tagKindForTemp(tempVal)}>
                                {tempVal}
                              </CrmTag>
                            ) : (
                              <CrmTag kind="info">No priority</CrmTag>
                            )}
                            <CrmTag kind={email.kind}>{email.label}</CrmTag>
                          </div>
                          <h4>{leadName ?? "Lead name unavailable"}</h4>
                          <span className="company">{d.companyName}</span>
                          {contact?.title || d.sector ? (
                            <span className="company">
                              {[contact?.title, d.sector]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                          <div className="crm-deal-value">
                            {formatAed(d.quoteValue)}
                          </div>
                          <div className="crm-deal-meta">
                            <span>{formatLane(d.leadSourceLane)}</span>
                            <span>{daysInStage}d in stage</span>
                          </div>
                          {d.closeOutcome ? (
                            <div className="mt-2 text-[10px] text-[var(--muted)]">
                              {retentionLabel(d.updatedAt)}
                            </div>
                          ) : null}
                          <div className="mt-2 border-t border-[var(--line)] pt-2 text-[10px] leading-5">
                            <strong className="block text-[var(--ink)]">
                              Next: {nextTask?.title ?? "Set a next action"}
                            </strong>
                            <span className="text-[var(--muted)]">
                              {taskOwner}
                              {nextTask?.dueDate
                                ? ` · ${new Date(nextTask.dueDate).toLocaleDateString("en-AE", { day: "numeric", month: "short" })}`
                                : " · No date"}
                            </span>
                          </div>
                        </Link>
                        {moveErrors[d.dealId] ? (
                          <p className="crm-note mt-2" role="alert">
                            Cannot move: {moveErrors[d.dealId]}
                          </p>
                        ) : null}
                        {d.closeOutcome ? (
                          <Link
                            href={`/crm/deals/${d.dealId}`}
                            className="crm-btn"
                          >
                            Open retained record →
                          </Link>
                        ) : nextStage ? (
                          <CrmBtn
                            variant="primary"
                            disabled={move.isPending}
                            onClick={() =>
                              void handleMove(d.dealId, nextStage.key)
                            }
                          >
                            Move to {nextStage.label} →
                          </CrmBtn>
                        ) : (
                          <Link
                            href={`/crm/deals/${d.dealId}`}
                            className="crm-btn"
                          >
                            Open handover →
                          </Link>
                        )}
                      </article>
                    );
                  })}
                  {col.length === 0 ? (
                    <div className="px-2 py-6 text-center text-[10px] text-[var(--muted)]">
                      No leads here yet
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
