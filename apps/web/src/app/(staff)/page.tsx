"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  dependencyBlockerLabel,
  staffWorkspaceFor,
  type StaffWorkspacePath,
} from "@/lib/staff-workspace";

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

function JobPathLink({
  path,
  primary = false,
}: {
  path: StaffWorkspacePath;
  primary?: boolean;
}) {
  return (
    <Link
      href={path.href}
      className={`ops-job-path${primary ? " is-primary" : ""}`}
      data-testid={primary ? "role-primary-action" : undefined}
    >
      <span className="ops-job-index">
        {primary ? "Start here" : path.index}
      </span>
      <span className="ops-job-copy">
        <strong>{path.title}</strong>
        <small>{path.description}</small>
      </span>
      <span className="ops-job-arrow" aria-hidden>
        ↗
      </span>
    </Link>
  );
}

export default function StaffHomePage() {
  const session = trpc.auth.session.useQuery();
  const enabledFeatures = new Set(session.data?.enabledFeatureKeys ?? []);
  const canLoadAssignedWork =
    Boolean(session.data?.employeeId) && enabledFeatures.has("work.my_tasks");
  const canLoadInbox =
    Boolean(session.data?.employeeId) && enabledFeatures.has("work.inbox");
  const assigned = trpc.work.personal.myTasks.useQuery(
    { includeCompleted: false },
    {
      enabled: canLoadAssignedWork,
      retry: false,
      refetchInterval: 30_000,
    },
  );
  const inbox = trpc.work.personal.inbox.useQuery(
    { unreadOnly: true },
    {
      enabled: canLoadInbox,
      retry: false,
      refetchInterval: 30_000,
    },
  );
  const workspace = staffWorkspaceFor(
    session.data?.roles ?? [],
    enabledFeatures,
  );
  const now = Date.now();
  const orderedWork = [...(assigned.data ?? [])].sort((a, b) => {
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
  const blockerVisibilityComplete = orderedWork.every(
    (item) => item.blockedByCount !== null,
  );
  const blockers = orderedWork.filter(
    (item) => (item.blockedByCount ?? 0) > 0,
  ).length;
  const needsAttention = orderedWork.filter((item) => {
    const overdue = item.dueAt ? Date.parse(item.dueAt) < now : false;
    return (
      (item.blockedByCount ?? 0) > 0 || item.priority === "urgent" || overdue
    );
  }).length;
  const dubaiDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Dubai",
  }).format(new Date());
  const scopedDataError = assigned.error ?? inbox.error;
  const actions = workspace.primaryAction
    ? [workspace.primaryAction, ...workspace.supportingActions]
    : [];

  return (
    <main className="ops-home">
      <section className="ops-command" aria-labelledby="ops-home-title">
        <div className="ops-command-atmosphere" aria-hidden />

        <header className="ops-command-header">
          <div className="ops-brand" aria-label="hrmny OS">
            hrmny <span>{workspace.label}</span>
          </div>
          <p>{dubaiDate} · Dubai</p>
        </header>

        <div className="ops-command-main">
          <div className="ops-command-intro">
            <p className="ops-eyebrow" data-testid="role-home-label">
              {workspace.label} view
            </p>
            <h1 id="ops-home-title">
              {workspace.headline} <em>{workspace.emphasis}</em>
            </h1>
            <p className="ops-support">{workspace.description}</p>

            <section
              className="ops-next-owned"
              aria-labelledby="next-owned-title"
              data-testid="next-owned-work"
            >
              <p id="next-owned-title">Next owned work</p>
              {!canLoadAssignedWork ? (
                <strong>My Tasks is not enabled for this access scope.</strong>
              ) : assigned.isLoading ? (
                <strong>Loading your scoped Work queue…</strong>
              ) : assigned.error ? (
                <strong>Your Work queue could not be loaded.</strong>
              ) : nextOwned ? (
                <>
                  <strong>{nextOwned.title}</strong>
                  <dl>
                    <div>
                      <dt>Owner</dt>
                      <dd>{session.data?.displayName ?? "You"}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        {nextOwned.itemType === "approval"
                          ? "Decision required"
                          : "Open"}
                      </dd>
                    </div>
                    <div>
                      <dt>Blocker</dt>
                      <dd>{dependencyBlockerLabel(nextOwned.blockedByCount)}</dd>
                    </div>
                    <div>
                      <dt>Evidence</dt>
                      <dd>Scoped Work item record</dd>
                    </div>
                    <div>
                      <dt>Project context</dt>
                      <dd>{nextOwned.projectName}</dd>
                    </div>
                    <div>
                      <dt>Next handoff</dt>
                      <dd>Open My Tasks</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <strong>No assigned Work items are open.</strong>
              )}
            </section>
          </div>

          <nav className="ops-job-paths" aria-label="Start work">
            {actions.map((action, index) => (
              <JobPathLink
                key={action.href}
                path={action}
                primary={index === 0}
              />
            ))}
            {actions.length === 0 ? (
              <p className="ops-path-empty">
                No operating area is enabled for this access scope.
              </p>
            ) : null}
          </nav>
        </div>

        <footer className="ops-command-footer">
          <nav className="ops-quick-paths" aria-label="More operations">
            <span>More</span>
            {workspace.moreActions.map((action) => (
              <Link key={action.href} href={action.href}>
                {action.title} <span aria-hidden>↗</span>
              </Link>
            ))}
          </nav>

          <section className="ops-live-pulse" aria-label="My live operations">
            <p aria-live="polite">
              <span className={scopedDataError ? "is-offline" : ""} />
              {scopedDataError
                ? "Scoped work unavailable"
                : "Live from permission-scoped Work"}
            </p>
            <dl>
              <div>
                <dt>Open</dt>
                <dd>
                  {canLoadAssignedWork ? (assigned.data?.length ?? "—") : "—"}
                </dd>
              </div>
              <div>
                <dt>Decisions</dt>
                <dd>{canLoadAssignedWork ? decisions : "—"}</dd>
              </div>
              <div>
                <dt>Blockers</dt>
                <dd>
                  {canLoadAssignedWork && blockerVisibilityComplete
                    ? blockers
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Attention</dt>
                <dd>{canLoadAssignedWork ? needsAttention : "—"}</dd>
              </div>
              <div>
                <dt>Inbox</dt>
                <dd>{canLoadInbox ? (inbox.data?.length ?? "—") : "—"}</dd>
              </div>
            </dl>
          </section>
        </footer>
      </section>
    </main>
  );
}
