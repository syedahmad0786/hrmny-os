"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { hasSyntheticMarker } from "@/lib/synthetic-records";

const humanStatus = (value: string | null | undefined) =>
  value
    ? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
    : "On track";

export default function PortalHomePage() {
  const session = trpc.portal.auth.session.useQuery(undefined, {
    retry: false,
  });
  const enabled = Boolean(session.data?.clientId);
  const approvals = trpc.portal.approvals.list.useQuery(undefined, { enabled });
  const briefs = trpc.portal.briefs.list.useQuery(undefined, { enabled });
  const tasks = trpc.portal.tasks.list.useQuery(undefined, { enabled });
  const assets = trpc.portal.assets.list.useQuery(undefined, { enabled });
  const deliveries = trpc.portal.deliveries.list.useQuery(undefined, {
    enabled,
  });
  const visibleApprovals = (approvals.data ?? []).filter(
    (item) => !hasSyntheticMarker(item.title),
  );
  const visibleTasks = (tasks.data ?? []).filter(
    (item) => !hasSyntheticMarker(item.title),
  );
  const visibleAssets = (assets.data ?? []).filter(
    (item) => !hasSyntheticMarker(item.title),
  );
  const pending = visibleApprovals.filter((item) => item.status === "pending");
  const openTasks = visibleTasks.filter(
    (item) => !["done", "completed", "cancelled"].includes(item.status),
  );
  const onboardingOpen = (briefs.data ?? []).some(
    (brief) => !brief.lockedAt || brief.missingRequiredCount > 0,
  );
  const currentStatus = deliveries.data?.[0]?.deliveryStatus;
  const firstName = session.data?.displayName?.split(/\s+/)[0] ?? "there";
  const primaryHref = pending.length
    ? "/portal/approvals"
    : "/portal/deliveries";
  const primaryLabel = pending.length
    ? "Review next item"
    : "View latest delivery";

  return (
    <main className="flex flex-col gap-6">
      <header className="grid gap-5 rounded-2xl bg-ink p-6 text-paper shadow-[var(--shadow)] sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">
            Your workspace
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Good to see you, {firstName}.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-paper/65">
            {pending.length
              ? `${pending.length} item${pending.length === 1 ? " needs" : "s need"} your decision. Start there to keep delivery moving.`
              : "Nothing is waiting for your approval. Your latest work and report are ready below."}
          </p>
        </div>
        <Link
          href={primaryHref}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-ochre px-5 text-sm font-bold text-ink"
        >
          {primaryLabel} →
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Needs approval", pending.length],
          ["Work in progress", openTasks.length],
          ["Files available", visibleAssets.length],
          ["Current status", humanStatus(currentStatus)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-[#ddd4c8] bg-white p-5"
          >
            <p className="text-xs text-muted">{label}</p>
            <strong className="mt-2 block font-display text-2xl text-ink">
              {value}
            </strong>
          </div>
        ))}
      </section>

      {pending[0] ? (
        <section className="rounded-2xl border border-ochre/30 bg-[#fff8ee] p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">
            Waiting for you
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl text-ink">
                {pending[0].title}
              </h2>
              <p className="mt-1 text-sm text-muted">
                Review the item, then approve it or request a change.
              </p>
            </div>
            <Link
              href="/portal/approvals"
              className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper"
            >
              Open approval →
            </Link>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        {onboardingOpen ? (
          <Link
            href="/portal/onboarding"
            className="rounded-2xl border border-[#ddd4c8] bg-white p-6 transition hover:border-ochre"
          >
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-ochre">
              Onboarding
            </p>
            <h2 className="mt-2 font-display text-2xl text-ink">
              Finish the information we need
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Complete the open brief so the team can start the next delivery
              step.
            </p>
          </Link>
        ) : null}
        <Link
          href="/portal/deliveries"
          className="rounded-2xl border border-[#ddd4c8] bg-white p-6 transition hover:border-ochre"
        >
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-ochre">
            Latest work
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink">
            Open your deliveries
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            See current work, completed items, and the latest files in one
            place.
          </p>
        </Link>
        <Link
          href="/portal/reports"
          className="rounded-2xl border border-[#ddd4c8] bg-white p-6 transition hover:border-ochre"
        >
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-ochre">
            Reports
          </p>
          <h2 className="mt-2 font-display text-2xl text-ink">
            See this month&apos;s progress
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            A clear summary of work completed, work open, and files delivered.
          </p>
        </Link>
      </section>
    </main>
  );
}
