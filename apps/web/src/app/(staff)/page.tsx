"use client";

import Link from "next/link";
import { Button, Card } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

const STATUS_STYLES: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-900",
  live_pending: "bg-amber-100 text-amber-900",
  blocked: "bg-red-100 text-red-900",
  next: "bg-sky-100 text-sky-900",
  active: "bg-emerald-100 text-emerald-900",
  missing: "bg-red-100 text-red-900",
  mock: "bg-stone-200 text-stone-800",
  tomorrow: "bg-violet-100 text-violet-900",
};

export default function StaffHomePage() {
  const status = trpc.ops.buildStatus.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  if (status.isLoading) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-muted">
        Loading build desk…
      </main>
    );
  }

  if (status.error || !status.data) {
    return (
      <main className="text-red-700">
        Could not load build status. Is the API running?
      </main>
    );
  }

  const data = status.data;

  return (
    <main className="flex flex-col gap-10">
      <section className="relative overflow-hidden rounded-2xl border border-sand bg-ink px-8 py-10 text-paper shadow-lg">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, rgba(228,115,0,0.55), transparent 55%), radial-gradient(ellipse at 90% 80%, rgba(228,115,0,0.2), transparent 40%)",
          }}
        />
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="font-display text-xs uppercase tracking-[0.28em] text-ochre">
              {data.phase}
            </p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight md:text-5xl">
              {data.product}
            </h1>
            <p className="mt-3 text-base text-sand/90">
              Live operating desk for Creative Harmony. Supabase, Postgres,
              Google Workspace sign-in, storage, and Vercel are connected;
              remaining external tool connections activate as credentials arrive.
            </p>
          </div>
          <div className="min-w-[200px] rounded-xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
            <p className="text-xs uppercase tracking-wider text-sand/70">
              Demo readiness
            </p>
            <p className="mt-1 font-display text-4xl text-ochre">
              {data.progress.percent}%
            </p>
            <p className="mt-1 text-sm text-sand/80">{data.progress.label}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-ochre transition-all"
                style={{ width: `${data.progress.percent}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl text-ink">90-day milestones</h2>
          <p className="text-sm text-muted">Click a card to open its demo</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.milestones.map((m) => (
            <Link key={m.id} href={m.href} className="group block">
              <Card className="h-full transition group-hover:border-ochre/50 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-xs uppercase tracking-[0.2em] text-ochre">
                    {m.id}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[m.status] ?? ""}`}
                  >
                    {m.status.replace("_", " ")}
                  </span>
                </div>
                <h3 className="mt-2 font-display text-xl text-ink">{m.title}</h3>
                <p className="mt-1 text-sm text-muted">{m.summary}</p>
                <p className="mt-4 text-xs text-muted">
                  Payment gate {m.fee}
                  {m.demoReady ? " · demo ready" : ""}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-ink">Connections</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.connections.map((c) => (
            <Card key={c.id} className="!p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-ink">{c.label}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[c.status] ?? ""}`}
                >
                  {c.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted">{c.detail}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <Card>
          <h2 className="font-display text-xl text-ink">Next actions</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink">
            {data.nextActions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </Card>
        <Card className="flex flex-col justify-between gap-4">
          <div>
            <h2 className="font-display text-xl text-ink">Quick open</h2>
            <p className="mt-1 text-sm text-muted">
              Auth mode: <code>{data.authMode}</code>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/sales">
              <Button type="button">Sales desk</Button>
            </Link>
            <Link href="/dashboards">
              <Button type="button" variant="ghost">
                Dashboards
              </Button>
            </Link>
            <Link href="/portal">
              <Button type="button" variant="ghost">
                Client portal
              </Button>
            </Link>
            <Link href="/settings/connections">
              <Button type="button" variant="ghost">
                Connections
              </Button>
            </Link>
          </div>
        </Card>
      </section>

      <p className="text-xs text-muted">
        Status refreshes every 15s · updated {new Date(data.updatedAt).toLocaleString()}
      </p>
    </main>
  );
}
