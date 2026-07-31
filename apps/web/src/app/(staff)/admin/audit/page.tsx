"use client";

import { Button } from "@hrmny/ui";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const audit = trpc.admin.audit.list.useQuery({
    limit: 50,
    action: action || undefined,
    entityType: entityType || undefined,
  });

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Audit log</h1>
        <p className="mt-1 text-muted">
          Append-only evidence for gates, assets, role changes and conventions.
        </p>
      </div>

      <section className="grid gap-3 rounded-xl border border-sand bg-white/70 p-4 sm:grid-cols-2">
        <label className="text-sm">
          Action contains
          <input
            className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
            value={action}
            placeholder="assets, roles, convention…"
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Entity type
          <input
            className="mt-1 w-full rounded border border-sand bg-white px-3 py-2"
            value={entityType}
            placeholder="asset, employee, convention…"
            onChange={(event) => setEntityType(event.target.value)}
          />
        </label>
      </section>

      {audit.isLoading ? (
        <p className="text-sm text-muted">Loading audit evidence…</p>
      ) : audit.isError ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{audit.error.message}</p>
          <Button
            type="button"
            variant="ghost"
            className="mt-2"
            onClick={() => void audit.refetch()}
          >
            Retry
          </Button>
        </section>
      ) : audit.data?.length ? (
        <div className="overflow-x-auto rounded-xl border border-sand bg-white/70">
          <table className="w-full min-w-[58rem] text-left text-sm">
            <thead>
              <tr className="border-b border-sand text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Reason / evidence</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.map((row) => (
                <tr
                  key={row.auditEventId}
                  className="border-b border-sand/70 align-top"
                >
                  <td className="whitespace-nowrap px-3 py-3">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 font-medium">{row.action}</td>
                  <td className="px-3 py-3">
                    <p>{row.entityType}</p>
                    <p className="max-w-52 truncate text-xs text-muted">
                      {row.entityId ?? "system"}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {row.actorEmployeeId ?? "system"}
                  </td>
                  <td className="px-3 py-3">
                    <p>{row.reason ?? "—"}</p>
                    {row.before || row.after ? (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted">
                          View before / after
                        </summary>
                        <pre className="mt-2 max-w-lg overflow-x-auto rounded bg-zinc-50 p-2">
                          {JSON.stringify(
                            { before: row.before, after: row.after },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className="rounded-xl border border-sand bg-white/70 p-6 text-sm text-muted">
          No audit events match these filters.
        </section>
      )}
    </main>
  );
}
