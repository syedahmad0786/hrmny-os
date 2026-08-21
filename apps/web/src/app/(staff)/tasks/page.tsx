"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function TasksHubPage() {
  const work = trpc.work.personal.myTasks.useQuery(
    {},
    {
      retry: false,
    },
  );
  const delivery = trpc.dashboards.delivery.useQuery(undefined, {
    retry: false,
  });
  const crmTasks = trpc.crm.tasks.list.useQuery(undefined, { retry: false });

  return (
    <main className="flex flex-col gap-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
          Work · Delivery · CRM
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">
          Task management
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Hub for personal work items, delivery queue, and CRM sales tasks.
          Approval routes live at{" "}
          <Link className="underline" href="/approvals">
            /approvals
          </Link>
          ; delivery board at{" "}
          <Link className="underline" href="/delivery">
            /delivery
          </Link>
          .
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href="/work/my-tasks"
          className="rounded-xl border border-sand bg-white/75 p-4 transition hover:border-ochre"
        >
          <h2 className="font-display text-lg font-semibold">My work tasks</h2>
          <p className="mt-2 text-sm text-muted">
            {work.isError
              ? "Open Work module"
              : `${work.data?.length ?? "…"} assigned`}
          </p>
        </Link>
        <Link
          href="/delivery"
          className="rounded-xl border border-sand bg-white/75 p-4 transition hover:border-ochre"
        >
          <h2 className="font-display text-lg font-semibold">Delivery</h2>
          <p className="mt-2 text-sm text-muted">
            {delivery.isError
              ? "Open delivery board"
              : "Capacity, traffic, creative QC"}
          </p>
        </Link>
        <Link
          href="/crm/tasks"
          className="rounded-xl border border-sand bg-white/75 p-4 transition hover:border-ochre"
        >
          <h2 className="font-display text-lg font-semibold">CRM tasks</h2>
          <p className="mt-2 text-sm text-muted">
            {crmTasks.isError
              ? "Open CRM tasks"
              : `${crmTasks.data?.length ?? "…"} sales follow-ups`}
          </p>
        </Link>
      </div>

      <section className="rounded-xl border border-sand bg-white/75 p-4 text-sm">
        <h2 className="font-display text-lg font-semibold">Routes</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li>
            <Link className="underline" href="/traffic">
              Traffic / DoR
            </Link>
          </li>
          <li>
            <Link className="underline" href="/creative">
              Creative + image gen
            </Link>
          </li>
          <li>
            <Link className="underline" href="/approvals">
              Approval queue
            </Link>
          </li>
          <li>
            <Link className="underline" href="/work">
              Work projects board
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
