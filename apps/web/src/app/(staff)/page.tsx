"use client";

import Link from "next/link";
import { Button, Card } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";

export default function StaffHomePage() {
  const overview = trpc.ops.overview.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (overview.isLoading) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-muted">
        Loading live operations…
      </main>
    );
  }
  if (overview.error || !overview.data) {
    return (
      <main className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
        Live operations could not be loaded. {overview.error?.message}
      </main>
    );
  }

  const data = overview.data;
  const cards = [
    {
      label: "People",
      value: `${data.activePeople} active`,
      detail: "Current employee directory",
      href: "/people",
    },
    {
      label: "CRM",
      value: `${data.openDeals} open deals`,
      detail: "Live commercial pipeline",
      href: "/crm",
    },
    {
      label: "Client work",
      value: `${data.activeClients} clients`,
      detail: `${data.openTasks} open delivery tasks`,
      href: "/delivery",
    },
    {
      label: "Integrations",
      value: `${data.connectedTools} connected`,
      detail: "Personal and business connections",
      href: "/settings/connections",
    },
    {
      label: "Audit activity",
      value: `${data.recentAudits} this week`,
      detail: data.latestAudit?.action ?? "No activity recorded yet",
      href: "/admin/audit",
    },
  ];

  return (
    <main className="flex flex-col gap-8">
      <section className="relative overflow-hidden rounded-2xl border border-sand bg-ink px-8 py-10 text-paper shadow-lg">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, rgba(228,115,0,0.55), transparent 55%), radial-gradient(ellipse at 90% 80%, rgba(228,115,0,0.2), transparent 40%)",
          }}
        />
        <div className="relative z-10 max-w-2xl">
          <p className="font-display text-xs uppercase tracking-[0.28em] text-ochre">
            Live operations
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Creative Harmony at a glance
          </h1>
          <p className="mt-3 text-base text-sand/90">
            People, commercial work, client delivery, connections, and audit
            activity from the operating system—not a project roadmap.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/client-preview">
              <Button type="button">Open client preview</Button>
            </Link>
            <Link href="/people">
              <Button type="button" variant="ghost">
                View people
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">
              Operational status
            </p>
            <h2 className="mt-1 font-display text-2xl text-ink">
              What is in the system now
            </h2>
          </div>
          <p className="text-xs text-muted">
            Updated {new Date(data.updatedAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((card) => (
            <Link key={card.label} href={card.href} className="group">
              <Card className="h-full transition group-hover:border-ochre/50 group-hover:shadow-md">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
                  {card.label}
                </p>
                <p className="mt-3 font-display text-2xl text-ink">{card.value}</p>
                <p className="mt-2 text-sm text-muted">{card.detail}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            01 · People
          </p>
          <h2 className="mt-2 font-display text-xl text-ink">Active team directory</h2>
          <p className="mt-2 text-sm text-muted">
            Show the current workforce, roles, departments, assets, and employee
            services.
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            02 · Client
          </p>
          <h2 className="mt-2 font-display text-xl text-ink">Durable client approval</h2>
          <p className="mt-2 text-sm text-muted">
            Preview Demo Co, approve or reject a deliverable, and keep the result
            after refresh.
          </p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            03 · Admin
          </p>
          <h2 className="mt-2 font-display text-xl text-ink">Connections and audit</h2>
          <p className="mt-2 text-sm text-muted">
            Manage personal tools and verify that sensitive actions leave an audit
            trail.
          </p>
        </Card>
      </section>
    </main>
  );
}
