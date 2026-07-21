"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

export default function RolesPage() {
  const session = trpc.auth.session.useQuery();
  const deal = trpc.deals.get.useQuery({
    id: "e0000000-0000-4000-8000-000000000001",
  });
  const permissions = trpc.admin.permissions.list.useQuery();
  const roles = trpc.admin.roles.list.useQuery();
  const margin = trpc.deals.margin.useQuery(undefined, {
    retry: false,
  });

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Roles & margin</h1>
      <p className="text-muted">
        Switch the Dev role in the header. AM payloads must omit margin/cost;
        partner and finance may call <code>deals.margin</code>.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-medium">Session</h2>
          <pre className="mt-2 overflow-x-auto text-sm">
            {JSON.stringify(session.data ?? null, null, 2)}
          </pre>
        </section>
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-medium">Deal payload (role-filtered)</h2>
          <pre className="mt-2 overflow-x-auto text-sm">
            {JSON.stringify(deal.data ?? null, null, 2)}
          </pre>
          <p className="mt-2 text-sm text-muted">
            Has marginPct?{" "}
            {deal.data && "marginPct" in deal.data ? "YES (fail if AM)" : "NO"}
          </p>
        </section>
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-medium">deals.margin (gated)</h2>
          {margin.isError ? (
            <p className="mt-2 text-sm text-[var(--hrmny-danger)]">
              Denied: {margin.error.message}
            </p>
          ) : (
            <pre className="mt-2 overflow-x-auto text-sm">
              {JSON.stringify(margin.data ?? null, null, 2)}
            </pre>
          )}
          <Button
            type="button"
            className="mt-3"
            variant="ghost"
            onClick={() => void margin.refetch()}
          >
            Retry margin
          </Button>
        </section>
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-medium">Roles / policies</h2>
          <pre className="mt-2 overflow-x-auto text-sm">
            {JSON.stringify(
              { roles: roles.data, permissions: permissions.data },
              null,
              2,
            )}
          </pre>
        </section>
      </div>
    </main>
  );
}
