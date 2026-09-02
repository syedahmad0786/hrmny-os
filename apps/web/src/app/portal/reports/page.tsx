"use client";

import { trpc } from "@/lib/trpc";

export default function PortalReportsPage() {
  const report = trpc.portal.reports.get.useQuery({});

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Progress
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-ink">
          Monthly report
        </h1>
        <p className="mt-2 text-muted">
          A simple view of work completed and still in progress.
        </p>
      </div>
      {report.data && (
        <section className="max-w-2xl rounded-xl border border-[#D9D0C4] bg-white/70 p-5">
          <p className="font-display text-xl font-semibold text-ink">
            {report.data.month}
          </p>
          {report.data.note ? (
            <p className="mt-2 text-sm text-muted">{report.data.note}</p>
          ) : null}
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-[#F4EFE7] p-4">
              <dt className="text-xs text-muted">In progress</dt>
              <dd className="mt-1 text-2xl font-semibold text-ink">
                {report.data.tasksOpen}
              </dd>
            </div>
            <div className="rounded-lg bg-[#F4EFE7] p-4">
              <dt className="text-xs text-muted">Completed</dt>
              <dd className="mt-1 text-2xl font-semibold text-ink">
                {report.data.tasksCompleted}
              </dd>
            </div>
            <div className="rounded-lg bg-[#F4EFE7] p-4">
              <dt className="text-xs text-muted">Files available</dt>
              <dd className="mt-1 text-2xl font-semibold text-ink">
                {report.data.assetsVisible}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </main>
  );
}
