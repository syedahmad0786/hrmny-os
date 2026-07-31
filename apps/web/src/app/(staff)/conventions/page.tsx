"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function ConventionsPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const list = trpc.conventions.list.useQuery(undefined, { retry: false });
  const upsert = trpc.conventions.upsert.useMutation({
    onSuccess: () => void utils.conventions.list.invalidate(),
  });
  const [editKey, setEditKey] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canEdit = Boolean(session.data?.canEditConventions);

  function startEdit(ruleKey: string, payload: Record<string, unknown>) {
    setEditKey(ruleKey);
    setJsonText(JSON.stringify(payload, null, 2));
    setError(null);
  }

  async function save() {
    if (!editKey) return;
    try {
      const payload = JSON.parse(jsonText) as Record<string, unknown>;
      await upsert.mutateAsync({ ruleKey: editKey, payload });
      setEditKey(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON or forbidden");
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Conventions</h1>
        <p className="mt-1 text-muted">
          Rules-as-data. Director (or partner) can edit; each save bumps version
          and writes an audit row.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {list.isLoading ? (
          <p className="text-sm text-muted">Loading conventions…</p>
        ) : null}
        {list.error ? (
          <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{list.error.message}</p>
            <Button
              className="mt-3"
              type="button"
              variant="ghost"
              onClick={() => void list.refetch()}
            >
              Retry
            </Button>
          </section>
        ) : null}
        {!list.isLoading && !list.error && list.data?.length === 0 ? (
          <p className="rounded-lg border border-sand p-4 text-sm text-muted">
            No active conventions.
          </p>
        ) : null}
        {(list.data ?? []).map((row) => (
          <div
            key={row.ruleKey}
            className="rounded-lg border border-sand bg-white/70 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{row.ruleKey}</p>
                <p className="text-sm text-muted">v{row.version}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => startEdit(row.ruleKey, row.payload)}
                disabled={!canEdit}
                title={
                  canEdit
                    ? "Edit convention"
                    : "Editing requires convention:edit"
                }
              >
                Edit
              </Button>
            </div>
            {editKey === row.ruleKey ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  aria-label={`${row.ruleKey} JSON payload`}
                  className="min-h-[140px] w-full rounded border border-sand bg-white p-2 font-mono text-sm"
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                />
                {error ? (
                  <p aria-live="polite" className="text-sm text-red-700">
                    {error}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => void save()}
                    disabled={upsert.isPending}
                  >
                    {upsert.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditKey(null);
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <pre className="mt-2 overflow-x-auto text-sm">
                {JSON.stringify(row.payload, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
