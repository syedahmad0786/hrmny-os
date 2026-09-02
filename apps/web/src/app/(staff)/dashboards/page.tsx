"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { formatAed } from "@/components/crm/format";
import {
  hasSyntheticMarker,
  isSyntheticRecordName,
} from "@/lib/synthetic-records";

export default function ReportsPage() {
  const session = trpc.auth.session.useQuery();
  const enabled = new Set(session.data?.enabledFeatureKeys ?? []);
  const pipeline = trpc.crmForecast.pipeline.useQuery(undefined, {
    enabled: enabled.has("crm.workspace"),
  });
  const tasks = trpc.work.personal.myTasks.useQuery(
    { includeCompleted: false },
    { enabled: enabled.has("work.my_tasks"), retry: false },
  );
  const clients = trpc.clients.list.useQuery(undefined, {
    enabled: enabled.has("crm.workspace"),
    retry: false,
  });
  const connections = trpc.connections.list.useQuery(undefined, {
    enabled: enabled.has("integrations.connections"),
    retry: false,
  });
  const visibleTasks = (tasks.data ?? []).filter(
    (task) => !hasSyntheticMarker(task.title, task.projectName),
  );
  const visibleClients = (clients.data ?? []).filter(
    (client) => !isSyntheticRecordName(client.name),
  );
  const connected = (connections.data ?? []).filter(
    (connection) => connection.status === "connected",
  ).length;

  const destinations = [
    enabled.has("crm.workspace")
      ? {
          href: "/crm",
          title: "Sales",
          summary: "Open opportunities, forecast, and next actions.",
          value: pipeline.data
            ? `${pipeline.data.totals.count} · ${formatAed(pipeline.data.totals.weightedValue)}`
            : "Loading…",
          label: "active · weighted",
        }
      : null,
    enabled.has("work.my_tasks")
      ? {
          href: "/work/my-tasks",
          title: "My work",
          summary: "Assigned work that still needs an owner action.",
          value: String(visibleTasks.length),
          label: "open items",
        }
      : null,
    enabled.has("crm.workspace")
      ? {
          href: "/clients",
          title: "Clients",
          summary: "Active relationships and current delivery paths.",
          value: String(visibleClients.length),
          label: "client accounts",
        }
      : null,
    enabled.has("integrations.connections")
      ? {
          href: "/settings/connections",
          title: "Connections",
          summary: "Tools available to Sales, Delivery, and Finance.",
          value: String(connected),
          label: "connected systems",
        }
      : null,
  ].filter(
    (
      item,
    ): item is {
      href: string;
      title: string;
      summary: string;
      value: string;
      label: string;
    } => Boolean(item),
  );

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="border-b border-[var(--line)] pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">
          Reports
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
          See what needs attention.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          A simple view of the operating numbers that are ready to trust. Open
          an area to investigate or take action.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {destinations.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-2xl border border-[var(--line)] bg-white p-6 transition hover:-translate-y-0.5 hover:border-ochre hover:shadow-[var(--shadow-soft)]"
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="font-display text-2xl text-ink">{item.title}</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                  {item.summary}
                </p>
              </div>
              <span className="text-ochre" aria-hidden>
                →
              </span>
            </div>
            <strong className="mt-8 block font-display text-4xl text-ink">
              {item.value}
            </strong>
            <span className="mt-1 block text-xs text-muted">{item.label}</span>
          </Link>
        ))}
      </section>

      <p className="rounded-xl border border-[var(--line)] bg-[#fff8ee] px-4 py-3 text-sm text-ink">
        Test and proof records are excluded from the figures on this page.
        Technical event logs remain available to administrators in Audit.
      </p>
    </main>
  );
}
