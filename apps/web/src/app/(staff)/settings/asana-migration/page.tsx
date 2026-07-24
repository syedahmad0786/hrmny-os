"use client";

import Link from "next/link";
import { Button } from "@hrmny/ui";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

const COUNT_LABELS: Record<string, string> = {
  users: "People",
  projects: "Projects",
  sections: "Sections",
  topLevelTasks: "Top-level tasks",
  subtasks: "Subtasks",
  tasks: "Unique tasks",
  projectTaskLinks: "Project-task links",
  multiHomedTasks: "Multi-homed tasks",
  tags: "Tags",
  customFields: "Custom fields",
  stories: "Activity stories",
  comments: "Comments",
  attachments: "Attachments",
};

export default function AsanaMigrationPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const syncEnabled =
    session.data?.enabledFeatureKeys.includes("asana.sync") ?? false;
  const status = trpc.asanaMigration.status.useQuery(undefined, {
    retry: false,
  });
  const [workspaceGid, setWorkspaceGid] = useState("");
  const [depth, setDepth] = useState<"structure" | "full">("full");
  const [confirmation, setConfirmation] = useState("");
  const [allowUnmappedUsers, setAllowUnmappedUsers] = useState(false);
  const dryRun = trpc.asanaMigration.dryRun.useMutation();
  const importWorkspace = trpc.asanaMigration.import.useMutation({
    onSuccess: async () => {
      await utils.work.projects.invalidate();
    },
  });
  const syncStatus = trpc.asanaMigration.syncStatus.useQuery(
    { workspaceGid },
    { enabled: Boolean(syncEnabled && workspaceGid), retry: false },
  );
  const syncNow = trpc.asanaMigration.syncNow.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.asanaMigration.syncStatus.invalidate(),
        utils.work.projects.invalidate(),
      ]);
    },
  });
  const webhookStatus = trpc.asanaMigration.syncWebhookStatus.useQuery(
    { workspaceGid },
    { enabled: Boolean(syncEnabled && workspaceGid), retry: false },
  );
  const enableWebhooks = trpc.asanaMigration.syncWebhookEnable.useMutation({
    onSuccess: async () => {
      await utils.asanaMigration.syncWebhookStatus.invalidate();
    },
  });
  const disableWebhooks = trpc.asanaMigration.syncWebhookDisable.useMutation({
    onSuccess: async () => {
      await utils.asanaMigration.syncWebhookStatus.invalidate();
    },
  });

  useEffect(() => {
    if (!workspaceGid && status.data?.workspaces[0]?.gid) {
      setWorkspaceGid(status.data.workspaces[0].gid);
    }
  }, [status.data?.workspaces, workspaceGid]);

  return (
    <main className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ochre">
          Migration control
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold">Asana scan</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Verify the connected account and inspect everything before importing.
          This scan reads Asana only and never changes either system.
        </p>
      </div>

      {status.isLoading ? (
        <p className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
          Verifying the Asana connection…
        </p>
      ) : status.error ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-display text-lg">Connection required</h2>
          <p className="mt-1 text-sm text-amber-900">{status.error.message}</p>
          <Link
            className="mt-3 inline-block text-sm font-semibold text-ochre underline"
            href="/settings/connections"
          >
            Open Connections
          </Link>
        </section>
      ) : status.data ? (
        <>
          <section className="rounded-lg border border-sand bg-white/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Verified through {status.data.provider}
                </p>
                <h2 className="mt-1 font-display text-xl">
                  {status.data.user.name}
                </h2>
                <p className="text-sm text-muted">
                  {status.data.user.email ?? status.data.providerUserId}
                </p>
              </div>
              <label className="min-w-64 text-sm">
                <span className="mb-1 block font-medium">Workspace</span>
                <select
                  className="w-full rounded border border-sand bg-white px-3 py-2"
                  value={workspaceGid}
                  onChange={(event) => {
                    setWorkspaceGid(event.target.value);
                    dryRun.reset();
                    importWorkspace.reset();
                  }}
                >
                  {status.data.workspaces.map((workspace) => (
                    <option key={workspace.gid} value={workspace.gid}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-sand pt-4">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Scan depth</span>
                <select
                  className="rounded border border-sand bg-white px-3 py-2"
                  value={depth}
                  onChange={(event) => {
                    setDepth(event.target.value as "structure" | "full");
                    dryRun.reset();
                    importWorkspace.reset();
                  }}
                >
                  <option value="full">Full — includes comments & files</option>
                  <option value="structure">Structure — faster</option>
                </select>
              </label>
              <Button
                type="button"
                disabled={!workspaceGid || dryRun.isPending}
                onClick={() => dryRun.mutate({ workspaceGid, depth })}
              >
                {dryRun.isPending ? "Scanning…" : "Run read-only scan"}
              </Button>
              <p className="max-w-lg text-xs text-muted">
                Full scans make two additional read calls per task and can take
                several minutes on a large workspace.
              </p>
            </div>
          </section>

          {syncEnabled ? (
            <section className="rounded-lg border border-sand bg-white/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl">Keep changes in sync</h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted">
                    Checks Asana&apos;s change cursor, then safely reconciles
                    the complete workspace when anything changed or a cursor
                    expired.
                  </p>
                  {syncStatus.data ? (
                    <p className="mt-2 text-xs text-muted">
                      {syncStatus.data.status === "error"
                        ? `Needs attention: ${syncStatus.data.lastError}`
                        : syncStatus.data.lastSyncedAt
                          ? `Last checked ${new Date(syncStatus.data.lastSyncedAt).toLocaleString()} · ${syncStatus.data.totalEventCount} events observed`
                          : "Ready to initialize"}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  disabled={!workspaceGid || syncNow.isPending}
                  onClick={() => syncNow.mutate({ workspaceGid })}
                >
                  {syncNow.isPending
                    ? "Syncing…"
                    : syncStatus.data
                      ? "Sync now"
                      : "Initialize sync"}
                </Button>
              </div>
              {syncNow.data ? (
                <p className="mt-3 text-sm font-medium text-emerald-800">
                  Checked {syncNow.data.eventCount} events
                  {syncNow.data.reconciled
                    ? " and reconciled the workspace."
                    : "; everything was already current."}
                </p>
              ) : null}
              {syncNow.error ? (
                <p className="mt-3 text-sm text-red-800">
                  {syncNow.error.message}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-sand pt-4">
                <div>
                  <h3 className="font-medium">Signed push updates</h3>
                  <p className="mt-1 max-w-2xl text-xs text-muted">
                    Creates one verified webhook for the workspace and each
                    current project. Push events wake the same safe
                    reconciliation job; cursor polling remains the fallback.
                  </p>
                  {webhookStatus.data ? (
                    <p className="mt-2 text-xs text-muted">
                      {webhookStatus.data.active} active
                      {webhookStatus.data.errors
                        ? ` · ${webhookStatus.data.errors} need attention`
                        : ""}
                    </p>
                  ) : null}
                </div>
                {webhookStatus.data?.active ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={enableWebhooks.isPending}
                      onClick={() => enableWebhooks.mutate({ workspaceGid })}
                    >
                      {enableWebhooks.isPending
                        ? "Refreshing…"
                        : "Refresh projects"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disableWebhooks.isPending}
                      onClick={() => disableWebhooks.mutate({ workspaceGid })}
                    >
                      {disableWebhooks.isPending
                        ? "Disabling…"
                        : "Disable push updates"}
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!workspaceGid || enableWebhooks.isPending}
                    onClick={() => enableWebhooks.mutate({ workspaceGid })}
                  >
                    {enableWebhooks.isPending
                      ? "Registering projects…"
                      : "Enable push updates"}
                  </Button>
                )}
              </div>
              {enableWebhooks.data?.failures.length ? (
                <p className="mt-3 text-sm text-amber-800">
                  {enableWebhooks.data.failures.length} webhook registrations
                  need retry. Active registrations were kept.
                </p>
              ) : null}
              {enableWebhooks.error || disableWebhooks.error ? (
                <p className="mt-3 text-sm text-red-800">
                  {(enableWebhooks.error ?? disableWebhooks.error)?.message}
                </p>
              ) : null}
            </section>
          ) : null}

          {dryRun.error ? (
            <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {dryRun.error.message}
            </p>
          ) : null}

          {dryRun.data ? (
            <>
              <section className="rounded-lg border border-sand bg-white/70 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-xl">Scan results</h2>
                  <p className="text-xs text-muted">
                    {new Date(dryRun.data.scannedAt).toLocaleString()}
                  </p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(dryRun.data.counts).map(([key, value]) => (
                    <div key={key} className="rounded border border-sand p-3">
                      <p className="text-xs text-muted">
                        {COUNT_LABELS[key] ?? key}
                      </p>
                      <p className="mt-1 font-display text-2xl">
                        {value ?? "Not scanned"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-lg border border-sand bg-white/70 p-4">
                  <h2 className="font-display text-lg">People mapping</h2>
                  <p className="mt-1 text-sm text-muted">
                    {dryRun.data.matchedUsers} matched by email ·{" "}
                    {dryRun.data.unmappedUsers.length} need review
                  </p>
                  <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-sm">
                    {dryRun.data.unmappedUsers.map((user) => (
                      <li
                        key={user.gid}
                        className="rounded border border-sand p-2"
                      >
                        <span className="font-medium">{user.name}</span>
                        <span className="ml-2 text-muted">
                          {user.email ?? "No email returned"}
                        </span>
                      </li>
                    ))}
                    {!dryRun.data.unmappedUsers.length ? (
                      <li className="text-emerald-700">Every user matched.</li>
                    ) : null}
                  </ul>
                </section>

                <section className="rounded-lg border border-sand bg-white/70 p-4">
                  <h2 className="font-display text-lg">Projects found</h2>
                  <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-sm">
                    {dryRun.data.projects.map((project) => (
                      <li
                        key={project.gid}
                        className="rounded border border-sand p-2"
                      >
                        <span className="font-medium">{project.name}</span>
                        <span className="ml-2 text-muted">
                          {[project.team, project.owner, project.privacy]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                <h2 className="font-display text-lg">Confirm import</h2>
                <p className="mt-1 max-w-3xl">
                  Review these counts first. Re-running an import updates the
                  same Asana records instead of duplicating them.
                </p>
                {dryRun.data.unmappedUsers.length ? (
                  <label className="mt-3 flex items-start gap-2">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={allowUnmappedUsers}
                      onChange={(event) =>
                        setAllowUnmappedUsers(event.target.checked)
                      }
                    />
                    <span>
                      Import with {dryRun.data.unmappedUsers.length} unmapped
                      people. Their assignments stay empty and their comments
                      are attributed to the importing admin.
                    </span>
                  </label>
                ) : null}
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label>
                    <span className="mb-1 block font-medium">
                      Type IMPORT to continue
                    </span>
                    <input
                      className="rounded border border-blue-300 bg-white px-3 py-2"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={
                      confirmation !== "IMPORT" ||
                      importWorkspace.isPending ||
                      Boolean(
                        dryRun.data.unmappedUsers.length && !allowUnmappedUsers,
                      )
                    }
                    onClick={() =>
                      importWorkspace.mutate({
                        workspaceGid,
                        confirmation: "IMPORT",
                        allowUnmappedUsers,
                      })
                    }
                  >
                    {importWorkspace.isPending
                      ? "Importing…"
                      : "Import into Work"}
                  </Button>
                </div>
                {importWorkspace.error ? (
                  <p className="mt-3 text-red-800">
                    {importWorkspace.error.message}
                  </p>
                ) : null}
                {importWorkspace.data ? (
                  <p className="mt-3 font-medium text-emerald-800">
                    Import completed. Run {importWorkspace.data.runId} is ready
                    in Work.
                  </p>
                ) : null}
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
