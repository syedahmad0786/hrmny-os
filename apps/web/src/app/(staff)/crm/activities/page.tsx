"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmPageHeader,
} from "@/components/crm/ui";
import { formatRelative, initials } from "@/components/crm/format";

const TYPE_COLOR: Record<string, string> = {
  email: "var(--info)",
  meeting: "var(--success)",
  call: "var(--ochre)",
  note: "var(--sand-2)",
  stage_change: "var(--ochre)",
  system: "var(--muted)",
};

export default function CrmActivitiesPage() {
  const utils = trpc.useUtils();
  const activities = trpc.crm.activities.list.useQuery({ limit: 100 });
  const deals = trpc.crm.deals.list.useQuery();
  const create = trpc.crm.activities.create.useMutation({
    onSuccess: () => void utils.crm.activities.invalidate(),
  });

  const [subject, setSubject] = useState("");
  const [type, setType] = useState<"note" | "call" | "meeting" | "email">("note");
  const [filter, setFilter] = useState("all");

  const dealMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deals.data ?? []) m.set(d.dealId, d.companyName);
    return m;
  }, [deals.data]);

  const rows = useMemo(() => {
    return (activities.data ?? []).filter(
      (a) => filter === "all" || a.type === filter,
    );
  }, [activities.data, filter]);

  const mix = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of activities.data ?? []) {
      counts[a.type] = (counts[a.type] ?? 0) + 1;
    }
    return counts;
  }, [activities.data]);

  return (
    <main>
      <CrmPageHeader
        title="Activity timeline"
        description="Calls, meetings, emails, notes and stage changes in one trace."
        actions={
          <CrmBtn
            variant="primary"
            disabled={create.isPending || !subject.trim()}
            onClick={() =>
              void create
                .mutateAsync({ type, subject: subject.trim() })
                .then(() => setSubject(""))
            }
          >
            Log activity
          </CrmBtn>
        }
      />

      <section className="crm-split">
        <div className="crm-panel">
          <div className="crm-panel-head">
            <div>
              <h3>Activity stream</h3>
              <p>Global timeline · newest first</p>
            </div>
            <select
              className="crm-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All activity</option>
              <option value="email">Email</option>
              <option value="meeting">Meetings</option>
              <option value="call">Calls</option>
              <option value="note">Notes</option>
              <option value="stage_change">Stage changes</option>
            </select>
          </div>
          <div className="crm-panel-body">
            <div className="crm-composer">
              <span className="crm-initials">{initials("LB")}</span>
              <input
                placeholder="Log a note, call or meeting…"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <select
                className="crm-select"
                value={type}
                onChange={(e) =>
                  setType(e.target.value as typeof type)
                }
              >
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
              </select>
              <CrmBtn
                variant="primary"
                disabled={create.isPending || !subject.trim()}
                onClick={() =>
                  void create
                    .mutateAsync({ type, subject: subject.trim() })
                    .then(() => setSubject(""))
                }
              >
                Log
              </CrmBtn>
            </div>

            {activities.isLoading ? (
              <CrmEmpty title="Loading activity…" />
            ) : rows.length === 0 ? (
              <CrmEmpty title="No activity yet" hint="Log the first touch to start the timeline." />
            ) : (
              <div className="crm-timeline">
                {rows.map((a) => (
                  <div key={a.activityId} className="crm-timeline-item">
                    <span
                      className="crm-timeline-dot"
                      style={{
                        background: TYPE_COLOR[a.type] ?? "var(--ochre)",
                      }}
                    />
                    <div>
                      <h4>
                        {a.subject ?? a.type}
                        {a.dealId && dealMap.get(a.dealId)
                          ? ` · ${dealMap.get(a.dealId)}`
                          : ""}
                      </h4>
                      <p>{a.body ?? `${a.type.replace(/_/g, " ")} logged`}</p>
                    </div>
                    <time>{formatRelative(a.occurredAt)}</time>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="crm-panel">
          <div className="crm-panel-head">
            <h3>Activity mix</h3>
          </div>
          <div className="crm-panel-body">
            <div className="crm-metric" style={{ marginBottom: 9 }}>
              <span className="crm-metric-label">Loaded</span>
              <strong>{(activities.data ?? []).length}</strong>
              <small>Across live CRM records</small>
            </div>
            <div className="crm-checklist">
              {Object.entries(mix).map(([k, v]) => (
                <div key={k} className="crm-check-row">
                  <span
                    className="crm-temp-dot"
                    style={{ background: TYPE_COLOR[k] ?? "var(--sand-2)" }}
                  />
                  {k.replace(/_/g, " ")}
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
