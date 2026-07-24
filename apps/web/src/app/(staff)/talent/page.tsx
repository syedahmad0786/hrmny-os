"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

type Row = Record<string, unknown>;

export default function TalentPage() {
  const session = trpc.auth.session.useQuery();
  const admin = (session.data?.roles ?? []).some((role) =>
    ["partner", "director", "hr", "hiring"].includes(role),
  );
  const requisitions = trpc.talent.requisitions.list.useQuery(undefined, {
    enabled: admin,
  });
  const cycles = trpc.talent.performance.cycles.list.useQuery();
  const goals = trpc.talent.performance.goals.list.useQuery();
  const surveys = trpc.talent.surveys.list.useQuery();

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">
          <Link className="underline" href="/people">
            People
          </Link>{" "}
          ·{" "}
          <Link className="underline" href="/time">
            Leave & attendance
          </Link>
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Talent</h1>
        <p className="mt-1 text-sm text-muted">
          Hiring, goals, reviews, and employee surveys in one place.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="Requisitions" value={requisitions.data?.length ?? 0} />
        <Metric label="Performance cycles" value={cycles.data?.length ?? 0} />
        <Metric label="My goals" value={goals.data?.length ?? 0} />
        <Metric label="Surveys" value={surveys.data?.length ?? 0} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <List
          title="Performance goals"
          rows={(goals.data ?? []) as Row[]}
          primary="title"
          secondary="status"
          empty="No goals yet."
        />
        <List
          title="Surveys"
          rows={(surveys.data ?? []) as Row[]}
          primary="title"
          secondary="status"
          empty="No surveys available."
        />
        {admin ? (
          <List
            title="Hiring requisitions"
            rows={(requisitions.data ?? []) as Row[]}
            primary="title"
            secondary="status"
            empty="No requisitions yet."
          />
        ) : null}
        <List
          title="Performance cycles"
          rows={(cycles.data ?? []) as Row[]}
          primary="name"
          secondary="status"
          empty="No performance cycle yet."
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
  empty,
}: {
  title: string;
  rows: Row[];
  primary: string;
  secondary: string;
  empty: string;
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
          <p className="text-muted">{empty}</p>
        )}
      </div>
    </section>
  );
}
