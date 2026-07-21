"use client";

import { trpc } from "@/lib/trpc";

export default function AuditPage() {
  const audit = trpc.admin.audit.list.useQuery({ limit: 20 });

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Audit log</h1>
      <p className="text-muted">
        Append-only <code>audit_event</code> rows from gate transitions and DAM.
        AM may be forbidden from listing (needs audit:view).
      </p>
      {audit.isError ? (
        <p className="text-sm text-[var(--hrmny-danger)]">{audit.error.message}</p>
      ) : (
        <pre className="overflow-x-auto rounded-lg border border-sand bg-white/70 p-4 text-sm">
          {JSON.stringify(audit.data ?? [], null, 2)}
        </pre>
      )}
    </main>
  );
}
