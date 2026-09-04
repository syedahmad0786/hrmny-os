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
  formatContactName,
  formatAed,
  formatLane,
  tagKindForTemp,
  workEmailState,
} from "@/components/crm/format";
import { DemoReadinessPanel } from "@/components/demo-readiness-panel";
import { DashStrip } from "./_components/dash-strip";
import { isSyntheticRecordName } from "@/lib/synthetic-records";

export default function CrmPipelinePage() {
  const utils = trpc.useUtils();
  const stages = trpc.crm.stages.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const contacts = trpc.crm.contacts.list.useQuery();
  const tasks = trpc.crm.tasks.list.useQuery();
  const activities = trpc.crm.activities.list.useQuery({ limit: 200 });
  const session = trpc.auth.session.useQuery();
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
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const contactById = useMemo(
    () =>
      new Map(
        (contacts.data ?? []).map((contact) => [contact.contactId, contact]),
      ),
    [contacts.data],
  );

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
      if (!showTestRecords && isSyntheticRecordName(d.companyName))
        return false;
      if (lane !== "all" && d.leadSourceLane !== lane) return false;
      if (temp !== "all" && (d.buafTemperature ?? "") !== temp) return false;
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
  }, [contactById, deals.data, search, lane, temp, showTestRecords]);

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
        {filtered.length} active deal{filtered.length === 1 ? "" : "s"}
      </p>

      <DashStrip />

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
                        {nextStage ? (
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
