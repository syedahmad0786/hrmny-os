"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { csvToObjects } from "@/lib/csv-parse";

export function AsanaRosterImport() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const preview = trpc.clients.previewAsanaRoster.useMutation();
  const apply = trpc.clients.importAsanaRoster.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
    },
  });
  const [error, setError] = useState("");
  if (!session.data?.roles.some((r) => r === "partner" || r === "director"))
    return null;
  return (
    <details className="rounded-xl border border-sand p-4">
      <summary className="cursor-pointer font-semibold">
        Import reviewed Asana client projects
      </summary>
      <p className="my-3 text-sm text-muted">
        Use active client projects from your Asana workspace. Exclude templates
        and internal work. Group projects under the same client name. Imported
        accounts keep contract values, renewal dates and account leads
        unrecorded until reviewed.
      </p>
      <p className="my-3 text-sm">
        CSV columns: clientName, projectName, projectId, workspaceId, observedAt
        (UTC date and time).
      </p>
      <label className="grid gap-2 text-sm">
        Review roster CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={preview.isPending || apply.isPending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError("");
            preview.reset();
            apply.reset();
            try {
              if (file.size > 1_000_000)
                throw new Error("Use a CSV smaller than 1 MB.");
              const rows = csvToObjects(await file.text()).map((row) => ({
                clientName: row.clientName ?? "",
                projectName: row.projectName ?? "",
                projectId: row.projectId ?? "",
                workspaceId: row.workspaceId ?? "",
                observedAt: row.observedAt ?? "",
              }));
              await preview.mutateAsync({ rows });
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Roster could not be read",
              );
            }
          }}
        />
      </label>
      {preview.data && !apply.data ? (
        <>
          <div className="my-4 overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="text-left">
                Reviewed project mapping · {preview.data.length} rows
              </caption>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Asana project</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.map((row, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4">{row.clientName}</td>
                    <td className="pr-4">{row.projectName}</td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="rounded-lg bg-ink px-4 py-2 text-white disabled:opacity-40"
            disabled={
              apply.isPending ||
              preview.data.some((r) => r.action === "invalid") ||
              preview.data.every((r) => r.action === "existing")
            }
            onClick={() => apply.mutate({ rows: preview.data! })}
          >
            Confirm reviewed roster
          </button>
        </>
      ) : null}
      {apply.data ? (
        <p role="status" className="mt-3">
          {apply.data.created} client accounts created · {apply.data.linked}{" "}
          projects linked · {apply.data.skipped} already linked.
        </p>
      ) : null}
      {error || apply.error ? (
        <p role="alert" className="mt-3 text-red-700">
          {error || apply.error?.message}
        </p>
      ) : null}
    </details>
  );
}
