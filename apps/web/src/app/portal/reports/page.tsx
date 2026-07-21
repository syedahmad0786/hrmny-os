"use client";

import { trpc } from "@/lib/trpc";

export default function PortalReportsPage() {
  const report = trpc.portal.reports.get.useQuery({});

  return (
    <main className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-ink">
        Activity report
      </h1>
      <p className="text-muted">{report.data?.note}</p>
      {report.data && (
        <dl className="grid max-w-md grid-cols-2 gap-4 text-sm">
          <dt className="text-muted">Month</dt>
          <dd>{report.data.month}</dd>
          <dt className="text-muted">Tasks open</dt>
          <dd>{report.data.tasksOpen}</dd>
          <dt className="text-muted">Tasks completed</dt>
          <dd>{report.data.tasksCompleted}</dd>
          <dt className="text-muted">Assets visible</dt>
          <dd>{report.data.assetsVisible}</dd>
        </dl>
      )}
    </main>
  );
}
