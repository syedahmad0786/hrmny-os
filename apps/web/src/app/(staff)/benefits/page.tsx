"use client";

import { trpc } from "@/lib/trpc";

type Row = Record<string, unknown>;

export default function BenefitsPage() {
  const catalog = trpc.benefits.catalog.list.useQuery();
  const enrolments = trpc.benefits.enrolments.list.useQuery();
  const dependants = trpc.benefits.dependants.list.useQuery();
  const perks = trpc.benefits.perks.list.useQuery();

  return (
    <main className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold">
          Benefits & insurance
        </h1>
        <p className="mt-1 text-sm text-muted">
          Eligible benefits, enrolments, dependants, health records and perks.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="Available benefits" value={catalog.data?.length ?? 0} />
        <Metric label="Enrolments" value={enrolments.data?.length ?? 0} />
        <Metric label="Dependants" value={dependants.data?.length ?? 0} />
        <Metric label="Perk usage" value={perks.data?.length ?? 0} />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <List
          title="Benefit catalogue"
          rows={(catalog.data ?? []) as Row[]}
          primary="name"
          secondary="category"
        />
        <List
          title="My enrolments"
          rows={(enrolments.data ?? []) as Row[]}
          primary="name"
          secondary="status"
        />
        <List
          title="Dependants"
          rows={(dependants.data ?? []) as Row[]}
          primary="display_name"
          secondary="relationship"
        />
        <List
          title="Perks"
          rows={(perks.data ?? []) as Row[]}
          primary="name"
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
