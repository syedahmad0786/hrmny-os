"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { hasSyntheticMarker } from "@/lib/synthetic-records";
import {
  dependencyBlockerLabel,
  staffWorkspaceFor,
  type StaffWorkspacePath,
} from "@/lib/staff-workspace";

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

function PathLink({ path }: { path: StaffWorkspacePath }) {
  return (
    <Link
      href={path.href}
      className="group flex min-h-24 items-center justify-between gap-5 rounded-xl border border-[var(--line)] bg-white px-5 py-4 transition hover:-translate-y-0.5 hover:border-[var(--ochre)] hover:shadow-[var(--shadow-soft)]"
    >
      <span>
        <strong className="block font-display text-lg text-ink">
          {path.title}
        </strong>
        <small className="mt-1 block max-w-sm text-xs leading-5 text-muted">
          {path.description}
        </small>
      </span>
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--line)] text-ochre group-hover:border-ochre"
        aria-hidden
      >
        →
      </span>
    </Link>
  );
}

function dueLabel(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Due date unavailable";
  return `Due ${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dubai",
  }).format(date)}`;
}

export default function StaffHomePage() {
  const session = trpc.auth.session.useQuery();
  const enabledFeatures = new Set(session.data?.enabledFeatureKeys ?? []);
  const canLoadAssignedWork =
    Boolean(session.data?.employeeId) && enabledFeatures.has("work.my_tasks");
  const canLoadInbox =
    Boolean(session.data?.employeeId) && enabledFeatures.has("work.inbox");
  const canLoadConnections = enabledFeatures.has("integrations.connections");
  const assigned = trpc.work.personal.myTasks.useQuery(
    { includeCompleted: false },
    { enabled: canLoadAssignedWork, retry: false, refetchInterval: 30_000 },
  );
  const inbox = trpc.work.personal.inbox.useQuery(
    { unreadOnly: true },
    { enabled: canLoadInbox, retry: false, refetchInterval: 30_000 },
  );
  const connections = trpc.connections.list.useQuery(undefined, {
    enabled: canLoadConnections,
    retry: false,
  });
  const workspace = staffWorkspaceFor(
    session.data?.roles ?? [],
    enabledFeatures,
  );
  const now = Date.now();
  const orderedWork = (assigned.data ?? [])
    .filter((item) => !hasSyntheticMarker(item.title, item.projectName))
    .sort((a, b) => {
      const aBlocked = (a.blockedByCount ?? 0) > 0 ? 1 : 0;
      const bBlocked = (b.blockedByCount ?? 0) > 0 ? 1 : 0;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      const aDecision = a.itemType === "approval" ? 0 : 1;
      const bDecision = b.itemType === "approval" ? 0 : 1;
      if (aDecision !== bDecision) return aDecision - bDecision;
      const aPriority = a.priority ? PRIORITY_RANK[a.priority] : 4;
      const bPriority = b.priority ? PRIORITY_RANK[b.priority] : 4;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
    });
  const nextOwned = orderedWork[0] ?? null;
  const decisions = orderedWork.filter(
    (item) => item.itemType === "approval",
  ).length;
  const blockers = orderedWork.filter(
    (item) => (item.blockedByCount ?? 0) > 0,
  ).length;
  const needsAttention = orderedWork.filter((item) => {
    const overdue = item.dueAt ? Date.parse(item.dueAt) < now : false;
    return (
      (item.blockedByCount ?? 0) > 0 || item.priority === "urgent" || overdue
    );
  }).length;
  const connected = (connections.data ?? []).filter(
    (item) => item.status === "connected",
  ).length;
  const dubaiDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Dubai",
  }).format(new Date());
  const firstName = session.data?.displayName?.split(/\s+/)[0] ?? "there";
  const starter = workspace.primaryAction;
  const primaryHref = nextOwned ? "/work/my-tasks" : (starter?.href ?? "/");
  const primaryLabel = nextOwned
    ? "Open this task"
    : (starter?.title ?? "Start");
  const paths = [
    workspace.primaryAction,
    ...workspace.supportingActions,
    ...workspace.moreActions,
  ].filter((item): item is StaffWorkspacePath => Boolean(item));

  return (
    <main
      className="mx-auto flex max-w-7xl flex-col gap-5"
      data-testid="today-page"
    >
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--line)] pb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-[0.14em] text-ochre"
            data-testid="role-home-label"
          >
            Today · {workspace.label}
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Good to see you, {firstName}.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {needsAttention
              ? `${needsAttention} item${needsAttention === 1 ? " needs" : "s need"} attention. Start with the one below.`
              : "Your urgent queue is clear. Choose the next part of the business to move."}
          </p>
        </div>
        <p className="text-xs font-medium text-muted">{dubaiDate} · Dubai</p>
      </header>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
        <article
          className="relative overflow-hidden rounded-2xl bg-ink p-6 text-paper shadow-[var(--shadow)] sm:p-8"
          data-testid="next-owned-work"
        >
          <div
            className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(228,115,0,.32),transparent_62%)]"
            aria-hidden
          />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ochre">
              Next action
            </p>
            {assigned.isLoading ? (
              <h2 className="mt-4 font-display text-2xl">Loading your work…</h2>
            ) : assigned.error ? (
              <>
                <h2 className="mt-4 font-display text-2xl">
                  Your work queue could not be loaded.
                </h2>
                <p className="mt-2 text-sm text-paper/60">
                  Try again from My work.
                </p>
              </>
            ) : nextOwned ? (
              <>
                <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold leading-tight sm:text-4xl">
                  {nextOwned.title}
                </h2>
                <p className="mt-3 text-sm text-paper/65">
                  {nextOwned.projectName} · {dueLabel(nextOwned.dueAt)} ·{" "}
                  {dependencyBlockerLabel(nextOwned.blockedByCount)}
                </p>
              </>
            ) : starter ? (
              <>
                <h2 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">
                  {starter.title}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-paper/65">
                  {starter.description}
                </p>
              </>
            ) : (
              <h2 className="mt-4 font-display text-3xl">
                Nothing needs you right now.
              </h2>
            )}
            <Link
              href={primaryHref}
              className="mt-7 inline-flex min-h-11 items-center rounded-full bg-ochre px-5 text-sm font-bold text-ink transition hover:bg-[#f28a22]"
              data-testid="role-primary-action"
            >
              {primaryLabel}{" "}
              <span className="ml-2" aria-hidden>
                →
              </span>
            </Link>
          </div>
        </article>

        <aside className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)]">
          {[
            ["Open work", String(orderedWork.length)],
            ["Decisions", String(decisions)],
            ["Blocked", String(blockers)],
            ["Unread", canLoadInbox ? String(inbox.data?.length ?? 0) : "—"],
          ].map(([label, value]) => (
            <div key={label} className="bg-white p-5">
              <p className="text-xs text-muted">{label}</p>
              <strong className="mt-3 block font-display text-3xl text-ink">
                {value}
              </strong>
            </div>
          ))}
          <Link
            href="/settings/connections"
            className="col-span-2 flex items-center justify-between bg-[#fff8ee] px-5 py-4 text-sm font-semibold text-ink hover:bg-[#fff1dc]"
          >
            <span>
              {connected} connected system{connected === 1 ? "" : "s"}
            </span>
            <span className="text-ochre">Manage →</span>
          </Link>
        </aside>
      </section>

      <section aria-labelledby="choose-path-title">
        <div className="mb-3">
          <h2 id="choose-path-title" className="font-display text-2xl text-ink">
            What do you want to move?
          </h2>
          <p className="mt-1 text-sm text-muted">
            Each path opens with the work and action that belong there.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {paths.slice(0, 6).map((path) => (
            <PathLink key={path.href} path={path} />
          ))}
        </div>
      </section>
    </main>
  );
}
