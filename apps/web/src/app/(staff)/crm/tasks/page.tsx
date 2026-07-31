"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CrmBtn,
  CrmEmpty,
  CrmFilterBar,
  CrmPageHeader,
  CrmTableShell,
  CrmTag,
} from "@/components/crm/ui";
import { formatRelative } from "@/components/crm/format";

export default function CrmTasksPage() {
  const utils = trpc.useUtils();
  const tasks = trpc.crm.tasks.list.useQuery();
  const companies = trpc.crm.companies.list.useQuery();
  const create = trpc.crm.tasks.create.useMutation({
    onSuccess: () => void utils.crm.tasks.invalidate(),
  });
  const update = trpc.crm.tasks.update.useMutation({
    onSuccess: () => void utils.crm.tasks.invalidate(),
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("openish");
  const [title, setTitle] = useState("");

  const companyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies.data ?? []) m.set(c.companyId, c.name);
    return m;
  }, [companies.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tasks.data ?? []).filter((t) => {
      if (status === "openish" && (t.status === "done" || t.status === "cancelled")) {
        return false;
      }
      if (status !== "all" && status !== "openish" && t.status !== status) {
        return false;
      }
      if (!q) return true;
      return t.title.toLowerCase().includes(q);
    });
  }, [tasks.data, search, status]);

  return (
    <main>
      <CrmPageHeader
        title="Sales tasks"
        description="Follow-ups and discovery actions kept separate from production work."
        actions={
          <CrmBtn
            variant="primary"
            disabled={create.isPending || !title.trim()}
            onClick={() =>
              void create.mutateAsync({ title: title.trim() }).then(() => setTitle(""))
            }
          >
            ＋ New sales task
          </CrmBtn>
        }
      />

      <CrmFilterBar>
        <input
          placeholder="Search sales tasks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          placeholder="New task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="openish">Open + in progress</option>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </CrmFilterBar>

      {tasks.isLoading ? (
        <CrmEmpty title="Loading tasks…" />
      ) : rows.length === 0 ? (
        <CrmEmpty title="No sales tasks" hint="Create a follow-up to keep deals moving." />
      ) : (
        <CrmTableShell foot="Sales tasks are separate from delivery production tasks.">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Linked company</th>
                <th>Status</th>
                <th>Due</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.crmTaskId}>
                  <td>
                    <strong>{t.title}</strong>
                  </td>
                  <td>
                    {t.companyId
                      ? (companyMap.get(t.companyId) ?? "—")
                      : "—"}
                  </td>
                  <td>
                    <CrmTag
                      kind={
                        t.status === "done"
                          ? "success"
                          : t.status === "in_progress"
                            ? "ochre"
                            : "info"
                      }
                    >
                      {t.status.replace(/_/g, " ")}
                    </CrmTag>
                  </td>
                  <td>{t.dueDate ?? "—"}</td>
                  <td>{formatRelative(t.updatedAt)}</td>
                  <td>
                    {t.status !== "done" ? (
                      <CrmBtn
                        variant="ghost"
                        onClick={() =>
                          void update.mutateAsync({
                            id: t.crmTaskId,
                            status: "done",
                          })
                        }
                      >
                        Mark done
                      </CrmBtn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrmTableShell>
      )}

      <div className="crm-note">
        Sales tasks are a separate entity from production tasks — shared UI patterns,
        separate permissions and reporting.
      </div>
    </main>
  );
}
