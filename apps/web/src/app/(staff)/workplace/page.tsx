"use client";

import { trpc } from "@/lib/trpc";

type Row = Record<string, unknown>;

export default function WorkplacePage() {
  const announcements = trpc.workplace.announcements.list.useQuery();
  const knowledge = trpc.workplace.knowledge.list.useQuery();
  const workflows = trpc.workplace.workflows.runs.useQuery();
  const requests = trpc.workplace.serviceRequests.list.useQuery();

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">Workplace</h1>
        <p className="mt-1 text-sm text-muted">
          Announcements, policies, employee workflows and service requests.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="Announcements" value={announcements.data?.length ?? 0} />
        <Metric
          label="Knowledge articles"
          value={knowledge.data?.length ?? 0}
        />
        <Metric label="My workflows" value={workflows.data?.length ?? 0} />
        <Metric label="Requests" value={requests.data?.length ?? 0} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <List
          title="Announcements"
          rows={(announcements.data ?? []) as Row[]}
          primary="title"
          secondary="status"
        />
        <List
          title="Knowledge Hub"
          rows={(knowledge.data ?? []) as Row[]}
          primary="title"
          secondary="category"
        />
        <List
          title="Workflow runs"
          rows={(workflows.data ?? []) as Row[]}
          primary="workflow_name"
          secondary="status"
        />
        <List
          title="Service requests"
          rows={(requests.data ?? []) as Row[]}
          primary="subject"
          secondary="status"
        />
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-sand bg-white/70 p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}

function List({
  title,
  rows,
  primary,
  secondary,
}: {
  title: string;
  rows: Row[];
  primary: string;
  secondary: string;
}) {
  return (
    <section className="rounded-lg border border-sand bg-white/70 p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-sm">
        {rows.length ? (
          rows.slice(0, 8).map((row, index) => (
            <div
              className="flex justify-between border-t border-sand/70 py-2"
              key={String(row.id ?? row[primary] ?? index)}
            >
              <span>{String(row[primary] ?? "Untitled")}</span>
              <span className="text-muted">{String(row[secondary] ?? "")}</span>
            </div>
          ))
        ) : (
          <p className="text-muted">Nothing here yet.</p>
        )}
      </div>
    </section>
  );
}
