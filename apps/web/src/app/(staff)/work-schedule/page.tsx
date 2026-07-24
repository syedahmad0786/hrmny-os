"use client";

import { trpc } from "@/lib/trpc";

type Row = Record<string, unknown>;

export default function WorkSchedulePage() {
  const shifts = trpc.shiftsTimesheets.shifts.list.useQuery();
  const entries = trpc.shiftsTimesheets.entries.list.useQuery();
  const changes = trpc.shiftsTimesheets.changes.list.useQuery();
  const projects = trpc.shiftsTimesheets.projects.list.useQuery();

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">Schedule & time</h1>
        <p className="mt-1 text-sm text-muted">
          Published shifts, change requests, projects and billable timesheets.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="Shifts in view" value={shifts.data?.length ?? 0} />
        <Metric label="Time entries" value={entries.data?.length ?? 0} />
        <Metric label="Change requests" value={changes.data?.length ?? 0} />
        <Metric label="Projects" value={projects.data?.length ?? 0} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <List
          title="Shifts"
          rows={(shifts.data ?? []) as Row[]}
          primary="name"
          secondary="status"
        />
        <List
          title="Timesheets"
          rows={(entries.data ?? []) as Row[]}
          primary="project_name"
          secondary="status"
        />
        <List
          title="Shift change requests"
          rows={(changes.data ?? []) as Row[]}
          primary="reason"
          secondary="status"
        />
        <List
          title="Projects"
          rows={(projects.data ?? []) as Row[]}
          primary="name"
          secondary="code"
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
