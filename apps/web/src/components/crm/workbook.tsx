"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTableShell } from "./ui";
import {
  defaultWorkbookConfig,
  DEFAULT_COLUMNS,
  filterWorkbookRows,
  TAB_LABELS,
  visibleColumns,
  WORKBOOK_COLUMNS,
  WORKBOOK_TABS,
  viewConfigSchema,
  type WorkbookConfig,
  type WorkbookRow,
  type WorkbookTab,
} from "@/lib/crm-workbook";
import { downloadWorkbookFile, workbookXlsx } from "@/lib/workbook-download";
import { CsvActions } from "@/app/(staff)/crm/_components/csv-actions";
import { MergeDuplicates } from "@/app/(staff)/crm/_components/merge-dedupe";

const descriptions: Record<WorkbookTab, string> = {
  leads:
    "Assess fit, assign an owner and plan the next conversation. Qualified leads keep their record and history in the pipeline.",
  contacts:
    "People, their companies and the last real interaction. Review missing details before outreach.",
  companies:
    "Your business relationships from first research to ongoing client work.",
  deals:
    "Commercial opportunities, commitments and the next step toward closing.",
  clients:
    "Confirmed customer engagements, account leads and upcoming renewals.",
  followups: "Every commitment has an owner, a date and a linked record.",
};
const attentionLabels = {
  all: "All records",
  unassigned: "Needs an owner",
  overdue: "Overdue",
  no_next_action: "No next action",
  unverified: "Email needs verification",
  data_review: "Data needs review",
  renewals: "Renewals in 60 days",
};
function WorkbookInner({ initialTab = "leads" }: { initialTab?: WorkbookTab }) {
  const utils = trpc.useUtils(),
    params = useSearchParams();
  const session = trpc.auth.session.useQuery();
  const snapshot = trpc.crm.workbook.snapshot.useQuery();
  const views = trpc.crm.workbook.views.useQuery();
  const stages = trpc.crm.stages.useQuery();
  const [config, setConfig] = useState<WorkbookConfig>(
    defaultWorkbookConfig(initialTab),
  );
  const [viewName, setViewName] = useState(""),
    [visibility, setVisibility] = useState<"personal" | "team">("personal");
  const [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false),
    [message, setMessage] = useState(""),
    [exporting, setExporting] = useState(false);
  const [editRows, setEditRows] = useState<WorkbookRow[]>([]),
    [field, setField] = useState<
      "ownerId" | "title" | "due" | "status" | "renewal"
    >("ownerId"),
    [value, setValue] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const openedRecord = useRef("");
  const employeeId = session.data?.employeeId ?? "";
  const preview = Boolean(session.data?.workspacePreview);
  const saveView = trpc.crm.workbook.saveView.useMutation({
    onSuccess: async () => {
      await utils.crm.workbook.views.invalidate();
      setMessage("View saved.");
      setViewName("");
    },
  });
  const deleteView = trpc.crm.workbook.deleteView.useMutation({
    onSuccess: () => void utils.crm.workbook.views.invalidate(),
  });
  const edit = trpc.crm.workbook.edit.useMutation({
    onSuccess: async (result) => {
      dialog.current?.close();
      setEditRows([]);
      setSelected([]);
      setMessage(
        `${result.updated} record${result.updated === 1 ? "" : "s"} updated.`,
      );
      await Promise.all([utils.crm.invalidate(), utils.clients.invalidate()]);
    },
  });
  const storageKey = `hrmny.crm.workbook.${employeeId}.${initialTab}`;
  useEffect(() => {
    if (!employeeId) return;
    let next = defaultWorkbookConfig(initialTab);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) next = viewConfigSchema.parse(JSON.parse(raw));
    } catch {
      /* An old view never prevents opening the CRM. */
    }
    const tab = params.get("tab");
    if (WORKBOOK_TABS.includes(tab as WorkbookTab))
      next = { ...next, tab: tab as WorkbookTab, columns: [] };
    const search = params.get("q");
    if (search !== null) next.search = search;
    if (params.get("record")) next.search = "";
    setConfig(next);
  }, [employeeId, initialTab, storageKey, params]);
  useEffect(() => {
    if (editRows.length) dialog.current?.showModal();
  }, [editRows]);
  const apply = (patch: Partial<WorkbookConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    setSelected([]);
    setPage(0);
    if (employeeId && !preview)
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Saved server views remain available. */
      }
  };
  const rows = useMemo(
    () => filterWorkbookRows(snapshot.data?.rows ?? [], config, employeeId),
    [snapshot.data, config, employeeId],
  );
  useEffect(() => {
    const id = params.get("record");
    if (!id || openedRecord.current === id || !snapshot.data) return;
    const row = snapshot.data.rows.find(
      (row) => row.id === id && row.kind === "followups",
    );
    if (!row) {
      setMessage("This follow-up no longer exists.");
      return;
    }
    openedRecord.current = id;
    setConfig({
      ...defaultWorkbookConfig("followups"),
      search: row.name,
      showTest: row.test,
    });
    if (!preview) {
      setField("title");
      setValue(row.name);
      setEditRows([row]);
    }
  }, [params, snapshot.data, preview]);
  useEffect(() => {
    setPage((page) =>
      Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1)),
    );
  }, [rows.length]);
  const columns = visibleColumns(config),
    pageRows = rows.slice(page * 50, page * 50 + 50);
  const selectedRows = rows.filter((row) => selected.includes(row.id));
  const statusOptions = Array.from(
    new Set(
      (snapshot.data?.rows ?? [])
        .filter(
          (row) => row.kind === (config.tab === "leads" ? "deals" : config.tab),
        )
        .map((row) => row.status),
    ),
  ).sort();
  const stageLabel = (stage: string) =>
    stages.data?.find((s) => s.key === stage)?.label ?? stage;
  const beginEdit = (
    records: WorkbookRow[],
    requestedField: typeof field = "ownerId",
  ) => {
    edit.reset();
    setField(requestedField);
    setValue(
      records.length === 1
        ? String(
            records[0]![requestedField === "title" ? "name" : requestedField] ??
              "",
          )
        : "",
    );
    setEditRows(records);
  };
  const exportRows = async (allTabs: boolean, xlsx: boolean) => {
    setExporting(true);
    setMessage("");
    try {
      const data = await utils.crm.workbook.export.fetch({
        config,
        ...(selected.length && !allTabs ? { ids: selected } : {}),
        allTabs,
      });
      if (xlsx)
        downloadWorkbookFile(
          workbookXlsx(data.sheets),
          `hrmny-${allTabs ? "workbook" : config.tab}.xlsx`,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      else
        downloadWorkbookFile(
          data.csv,
          `hrmny-${config.tab}.csv`,
          "text/csv;charset=utf-8",
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <main className="crm-workbook" data-testid="crm-workbook">
      <CrmPageHeader
        title={TAB_LABELS[config.tab]}
        kicker="Sales · Live workbook"
        description={descriptions[config.tab]}
        actions={
          <>
            <CrmBtn
              onClick={() => void snapshot.refetch()}
              disabled={snapshot.isFetching}
            >
              Refresh
            </CrmBtn>
            {config.tab === "clients" ? (
              <Link className="crm-btn primary" href="/clients">
                Client directory
              </Link>
            ) : (
              <CrmBtn
                variant="primary"
                disabled={preview}
                onClick={() => setCreateOpen(!createOpen)}
              >
                Add{" "}
                {config.tab === "leads" || config.tab === "deals"
                  ? "lead"
                  : config.tab === "followups"
                    ? "follow-up"
                    : config.tab === "contacts"
                      ? "contact"
                      : "company"}
              </CrmBtn>
            )}
          </>
        }
      />
      <div className="workbook-health" aria-label="Sales record health">
        <button
          onClick={() =>
            apply({ ...defaultWorkbookConfig("leads"), tab: "deals" })
          }
        >
          <strong>{snapshot.data?.health.open ?? "—"}</strong> Open
          opportunities
        </button>
        <button
          onClick={() =>
            apply({
              ...defaultWorkbookConfig("deals"),
              attention: "unassigned",
            })
          }
        >
          <strong>{snapshot.data?.health.unassigned ?? "—"}</strong> Need an
          owner
        </button>
        <button
          onClick={() =>
            apply({
              ...defaultWorkbookConfig("deals"),
              attention: "no_next_action",
            })
          }
        >
          <strong>{snapshot.data?.health.noNextAction ?? "—"}</strong> Need a
          next step
        </button>
        <button
          onClick={() =>
            apply({
              ...defaultWorkbookConfig("followups"),
              attention: "overdue",
            })
          }
        >
          <strong>{snapshot.data?.health.overdue ?? "—"}</strong> Overdue
          follow-ups
        </button>
      </div>
      <nav className="workbook-tabs" aria-label="Workbook sheets">
        {WORKBOOK_TABS.map((tab) => (
          <button
            key={tab}
            aria-pressed={config.tab === tab}
            onClick={() => apply(defaultWorkbookConfig(tab))}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>
      <div className="workbook-tools">
        <label>
          Search
          <input
            value={config.search}
            placeholder={`Search ${TAB_LABELS[config.tab].toLowerCase()}`}
            onChange={(e) => apply({ search: e.target.value })}
          />
        </label>
        <label>
          Owner
          <select
            value={config.owner}
            onChange={(e) => apply({ owner: e.target.value })}
          >
            <option value="all">Everyone</option>
            <option value="me">My records</option>
            {snapshot.data?.employees.map((e) => (
              <option value={e.id} key={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={config.status}
            onChange={(e) => apply({ status: e.target.value })}
          >
            <option value="all">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Focus
          <select
            value={config.attention}
            onChange={(e) =>
              apply({
                attention: e.target.value as WorkbookConfig["attention"],
              })
            }
          >
            {Object.entries(attentionLabels).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>Columns</summary>
          <div className="workbook-column-picker">
            {Object.entries(WORKBOOK_COLUMNS).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={columns.includes(key as (typeof columns)[number])}
                  disabled={key === "name"}
                  onChange={(e) =>
                    apply({
                      columns: e.target.checked
                        ? [...columns, key]
                        : columns.filter((c) => c !== key),
                    })
                  }
                />
                {label}
              </label>
            ))}
            <CrmBtn
              onClick={() => apply({ columns: DEFAULT_COLUMNS[config.tab] })}
            >
              Reset columns
            </CrmBtn>
          </div>
        </details>
        <label className="workbook-check">
          <input
            type="checkbox"
            checked={config.showTest}
            onChange={(e) => apply({ showTest: e.target.checked })}
          />
          Show test records
        </label>
      </div>
      <div className="workbook-tools">
        <label>
          Saved view
          <select
            aria-label="Saved workbook view"
            value=""
            onChange={(e) => {
              const view = views.data?.find((v) => v.id === e.target.value);
              if (view) apply(view.config);
            }}
          >
            <option value="">Choose a saved view</option>
            {views.data?.map((v) => (
              <option value={v.id} key={v.id}>
                {v.name} · {v.visibility === "team" ? "Team" : "Personal"}
              </option>
            ))}
          </select>
        </label>
        <label>
          View name
          <input
            value={viewName}
            maxLength={80}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="e.g. Hospitality prospects"
          />
        </label>
        <label>
          Visibility
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          >
            <option value="personal">Only me</option>
            <option value="team">Sales team</option>
          </select>
        </label>
        <CrmBtn
          disabled={preview || !viewName.trim() || saveView.isPending}
          onClick={() =>
            saveView.mutate({ name: viewName, visibility, config })
          }
        >
          Save view
        </CrmBtn>
        <details>
          <summary>Manage my views</summary>
          {views.data
            ?.filter((v) => v.ownerId === employeeId)
            .map((v) => (
              <p key={v.id}>
                {v.name}{" "}
                <CrmBtn
                  disabled={preview || deleteView.isPending}
                  onClick={() => deleteView.mutate({ id: v.id })}
                >
                  Remove view
                </CrmBtn>
              </p>
            ))}
        </details>
        <details>
          <summary>Export</summary>
          <div className="workbook-export">
            <CrmBtn
              disabled={preview || exporting}
              onClick={() => void exportRows(false, false)}
            >
              Current {selected.length ? "selection" : "view"} · CSV
            </CrmBtn>
            <CrmBtn
              disabled={preview || exporting}
              onClick={() => void exportRows(false, true)}
            >
              Current {selected.length ? "selection" : "view"} · Excel
            </CrmBtn>
            <CrmBtn
              disabled={preview || exporting}
              onClick={() => void exportRows(true, true)}
            >
              All sheets · Excel
            </CrmBtn>
            <small>
              Exports use these filters and your access. Private message content
              is excluded.
            </small>
          </div>
        </details>
      </div>
      {["contacts", "companies"].includes(config.tab) ? (
        <details className="workbook-import">
          <summary>Import and review duplicates</summary>
          <CsvActions
            kind={config.tab as "contacts" | "companies"}
            importOnly
          />
          <MergeDuplicates kind={config.tab as "contacts" | "companies"} />
        </details>
      ) : null}
      {createOpen ? (
        <WorkbookCreate
          kind={config.tab}
          rows={snapshot.data?.rows ?? []}
          onDone={() => {
            setCreateOpen(false);
            void utils.crm.invalidate();
          }}
        />
      ) : null}
      {message || saveView.error || deleteView.error ? (
        <p role="status">
          {message || saveView.error?.message || deleteView.error?.message}
        </p>
      ) : null}
      {selectedRows.length ? (
        <div className="workbook-selection">
          <strong>{selectedRows.length} selected</strong>
          <CrmBtn
            disabled={preview || selectedRows.length > 100}
            onClick={() => beginEdit(selectedRows)}
          >
            Assign owner
          </CrmBtn>
          {config.tab === "followups" || config.tab === "clients" ? (
            <CrmBtn
              disabled={preview || selectedRows.length > 100}
              onClick={() => beginEdit(selectedRows, "status")}
            >
              Change status
            </CrmBtn>
          ) : null}
          <CrmBtn onClick={() => setSelected([])}>Clear selection</CrmBtn>
        </div>
      ) : null}
      {snapshot.error ? (
        <p role="alert">Could not load records: {snapshot.error.message}</p>
      ) : snapshot.isLoading ? (
        <CrmEmpty title="Loading CRM records…" />
      ) : rows.length === 0 ? (
        <CrmEmpty
          title="No records in this view"
          hint={
            config.tab === "clients"
              ? "Add confirmed customers in the client directory, or finish a won deal handover."
              : "Change the filters or add a record to start."
          }
        />
      ) : (
        <CrmTableShell
          foot={`${rows.length} ${TAB_LABELS[config.tab].toLowerCase()} · ${selected.length} selected · page ${page + 1} of ${Math.ceil(rows.length / 50)}`}
        >
          <table className="crm-table workbook-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select this page"
                    checked={
                      pageRows.length > 0 &&
                      pageRows.every((r) => selected.includes(r.id))
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? Array.from(
                              new Set([
                                ...selected,
                                ...pageRows.map((r) => r.id),
                              ]),
                            )
                          : selected.filter(
                              (id) => !pageRows.some((r) => r.id === id),
                            ),
                      )
                    }
                  />
                </th>
                {columns.map((col) => (
                  <th
                    key={col}
                    aria-sort={
                      config.sort === col
                        ? config.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button
                      onClick={() =>
                        apply({
                          sort: col,
                          descending: config.sort === col && !config.descending,
                        })
                      }
                    >
                      {WORKBOOK_COLUMNS[col]}
                      {config.sort === col
                        ? config.descending
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={`${row.kind}:${row.id}`}
                  data-testid={`workbook-row-${row.id}`}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.name}`}
                      checked={selected.includes(row.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, row.id]
                            : selected.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                  {columns.map((col) => (
                    <td key={col}>
                      {col === "name" ? (
                        <>
                          <Link
                            className="workbook-record-link"
                            href={row.href}
                          >
                            {row.name}
                          </Link>
                          {row.issues.length ? (
                            <small className="workbook-issue">
                              {row.issues.join(" · ")}
                            </small>
                          ) : null}
                        </>
                      ) : col === "stage" ? (
                        stageLabel(row.stage)
                      ) : ["lastInteraction", "updatedAt"].includes(col) ? (
                        row[col] ? (
                          new Date(row[col]).toLocaleDateString()
                        ) : (
                          "Not recorded"
                        )
                      ) : (
                        row[col] || "—"
                      )}
                    </td>
                  ))}
                  <td>
                    <CrmBtn disabled={preview} onClick={() => beginEdit([row])}>
                      Assign
                    </CrmBtn>
                    {row.kind === "followups" ? (
                      <CrmBtn
                        disabled={preview}
                        onClick={() => beginEdit([row], "due")}
                      >
                        Edit follow-up
                      </CrmBtn>
                    ) : (
                      <Link className="crm-btn" href={row.href}>
                        Open
                      </Link>
                    )}
                    {row.kind === "clients" ? (
                      <CrmBtn
                        disabled={preview}
                        onClick={() => beginEdit([row], "renewal")}
                      >
                        Renewal
                      </CrmBtn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrmTableShell>
      )}
      {rows.length > 50 ? (
        <div className="workbook-pagination">
          <CrmBtn disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </CrmBtn>
          <CrmBtn
            disabled={(page + 1) * 50 >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            Next
          </CrmBtn>
        </div>
      ) : null}
      <dialog
        ref={dialog}
        className="workbook-dialog"
        onCancel={() => setEditRows([])}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!editRows[0]) return;
            edit.mutate({
              kind: editRows[0].kind,
              records: editRows.map((row) => ({
                id: row.id,
                updatedAt: row.updatedAt,
              })),
              field,
              value: value || null,
            });
          }}
        >
          <h2>
            Review{" "}
            {editRows.length === 1
              ? editRows[0]?.name
              : `${editRows.length} selected records`}
          </h2>
          <label>
            Change
            <select
              value={field}
              onChange={(e) => {
                setField(e.target.value as typeof field);
                setValue("");
              }}
            >
              <option value="ownerId">Owner</option>
              {editRows[0]?.kind === "followups" ? (
                <>
                  <option value="title">Title</option>
                  <option value="due">Due date</option>
                  <option value="status">Status</option>
                </>
              ) : null}
              {editRows[0]?.kind === "clients" ? (
                <>
                  <option value="renewal">Renewal date</option>
                  <option value="status">Status</option>
                </>
              ) : null}
            </select>
          </label>
          <label>
            New value
            {field === "ownerId" ? (
              <select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Unassigned</option>
                {snapshot.data?.employees.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            ) : field === "status" ? (
              <select
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">Choose status</option>
                {(editRows[0]?.kind === "clients"
                  ? [
                      "onboarding",
                      "active",
                      "renewing",
                      "at_risk",
                      "churned",
                      "closed",
                    ]
                  : ["open", "in_progress", "done", "cancelled"]
                ).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input
                aria-label="New value"
                type={field === "title" ? "text" : "date"}
                required={field === "title"}
                maxLength={300}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </label>
          <ul>
            {editRows.slice(0, 6).map((row) => (
              <li key={row.id}>
                {row.name} · currently{" "}
                {String(row[field === "title" ? "name" : field] || "not set")}
              </li>
            ))}
          </ul>
          {edit.error ? <p role="alert">{edit.error.message}</p> : null}
          <div className="workbook-actions">
            <CrmBtn
              disabled={edit.isPending}
              onClick={() => {
                dialog.current?.close();
                setEditRows([]);
              }}
            >
              Cancel
            </CrmBtn>
            <CrmBtn
              variant="primary"
              type="submit"
              disabled={preview || edit.isPending}
            >
              {edit.isPending ? "Saving…" : "Apply changes"}
            </CrmBtn>
          </div>
        </form>
      </dialog>
    </main>
  );
}

function WorkbookCreate({
  kind,
  rows,
  onDone,
}: {
  kind: WorkbookTab;
  rows: WorkbookRow[];
  onDone: () => void;
}) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [companyId, setCompanyId] = useState(""),
    [dueDate, setDueDate] = useState(""),
    [dealId, setDealId] = useState("");
  const companies = trpc.crm.companies.create.useMutation({
    onSuccess: onDone,
  });
  const contacts = trpc.crm.contacts.create.useMutation({ onSuccess: onDone });
  const deals = trpc.crm.deals.create.useMutation({ onSuccess: onDone });
  const tasks = trpc.crm.tasks.create.useMutation({ onSuccess: onDone });
  const error = companies.error ?? contacts.error ?? deals.error ?? tasks.error;
  const pending =
    companies.isPending ||
    contacts.isPending ||
    deals.isPending ||
    tasks.isPending;
  return (
    <form
      className="workbook-create workbook-tools"
      onSubmit={(e) => {
        e.preventDefault();
        if (kind === "companies") companies.mutate({ name });
        else if (kind === "contacts")
          contacts.mutate({
            firstName: name,
            email: email || null,
            companyId: companyId || null,
          });
        else if (kind === "followups")
          tasks.mutate({
            title: name,
            dueDate,
            dealId: dealId || null,
            companyId: companyId || null,
          });
        else
          deals.mutate({
            companyName: rows.find((r) => r.id === companyId)?.name ?? name,
            companyId: companyId || null,
            leadSourceLane: "relationship_led",
          });
      }}
    >
      <label>
        {kind === "followups"
          ? "Action"
          : kind === "contacts"
            ? "First name"
            : "Name"}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
        />
      </label>
      {kind !== "companies" ? (
        <label>
          Company
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">
              {kind === "contacts" ? "Link later" : "Choose a company"}
            </option>
            {rows
              .filter((r) => r.kind === "companies")
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {kind === "contacts" ? (
        <label>
          Work email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      ) : null}
      {kind === "followups" ? (
        <>
          <label>
            Deal
            <select
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              required={!companyId}
            >
              <option value="">Choose a deal or company</option>
              {rows
                .filter((r) => r.kind === "deals")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Due date
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </>
      ) : null}
      <CrmBtn variant="primary" type="submit" disabled={pending}>
        Create record
      </CrmBtn>
      <CrmBtn onClick={onDone}>Cancel</CrmBtn>
      {error ? <p role="alert">{error.message}</p> : null}
    </form>
  );
}

export function CrmWorkbook(props: { initialTab?: WorkbookTab }) {
  return (
    <Suspense fallback={<CrmEmpty title="Loading workbook…" />}>
      <WorkbookInner {...props} />
    </Suspense>
  );
}
