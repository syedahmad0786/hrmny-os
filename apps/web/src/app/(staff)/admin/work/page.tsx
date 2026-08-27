"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type Tab =
  | "organization"
  | "teams"
  | "guests"
  | "members"
  | "roles"
  | "identity"
  | "sandboxes"
  | "api"
  | "ai"
  | "exports";

function download(result: {
  filename: string;
  contentType: string;
  content: string;
}) {
  const url = URL.createObjectURL(
    new Blob([result.content], { type: result.contentType }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  link.click();
  URL.revokeObjectURL(url);
}

const inputClass =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm";
const cardClass = "rounded-xl border border-sand bg-white/75 p-5";

export default function WorkAdminPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const enabled = useMemo(
    () => new Set(session.data?.enabledFeatureKeys ?? []),
    [session.data?.enabledFeatureKeys],
  );
  const [tab, setTab] = useState<Tab>("organization");
  const directory = trpc.workAdmin.directory.useQuery();
  const policy = trpc.workAdmin.policy.get.useQuery(undefined, {
    enabled: enabled.has("work.domain_controls"),
  });
  const teams = trpc.workAdmin.teams.list.useQuery(undefined, {
    enabled: enabled.has("work.teams"),
  });
  const guests = trpc.workAdmin.guests.list.useQuery(undefined, {
    enabled: enabled.has("work.guests"),
  });
  const members = trpc.workAdmin.members.list.useQuery(undefined, {
    enabled: enabled.has("work.view_only"),
  });
  const roles = trpc.workAdmin.rbac.list.useQuery(undefined, {
    enabled: enabled.has("work.custom_rbac"),
  });
  const identity = trpc.workAdmin.identity.get.useQuery(undefined, {
    enabled: enabled.has("work.sso_scim"),
  });
  const sandboxes = trpc.workAdmin.sandboxes.get.useQuery(undefined, {
    enabled: enabled.has("work.sandboxes"),
  });
  const apiWebhooks = trpc.workAdmin.apiWebhooks.get.useQuery(undefined, {
    enabled: enabled.has("work.api_webhooks"),
  });
  const anyAiEnabled = [...enabled].some((key) => key.startsWith("work.ai."));
  const aiGovernance = trpc.workAdmin.aiGovernance.get.useQuery(undefined, {
    enabled: anyAiEnabled,
  });

  const tabs = [
    ["organization", "Organization", "work.domain_controls"],
    ["teams", "Teams", "work.teams"],
    ["guests", "Guests", "work.guests"],
    ["members", "Members", "work.view_only"],
    ["roles", "Roles", "work.custom_rbac"],
    ["identity", "SSO & SCIM", "work.sso_scim"],
    ["sandboxes", "Sandbox", "work.sandboxes"],
    ["api", "API & webhooks", "work.api_webhooks"],
    ["ai", "AI governance", "work.ai.any"],
    ["exports", "Exports", "work.data_export"],
  ] as const;
  const visibleTabs = tabs.filter(([, , feature]) => {
    if (feature === "work.data_export")
      return (
        enabled.has("work.data_export") || enabled.has("work.audit_export")
      );
    if (feature === "work.ai.any") return anyAiEnabled;
    return enabled.has(feature);
  });

  useEffect(() => {
    if (!visibleTabs.some(([key]) => key === tab) && visibleTabs[0]) {
      setTab(visibleTabs[0][0]);
    }
  }, [enabled, tab]);

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Admin · Work governance
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Organization admin console
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Manage teams, external collaborators, workspace licenses, role
            permissions, sharing defaults, and compliance exports.
          </p>
        </div>
        <nav
          className="flex flex-wrap gap-2 text-sm"
          aria-label="Admin settings"
        >
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/admin/features"
          >
            Feature Lab
          </Link>
          <Link
            className="rounded-full bg-ink px-4 py-2 text-white"
            href="/admin/work"
          >
            Work admin
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/settings/connections"
          >
            Connections
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/admin/audit"
          >
            Audit
          </Link>
        </nav>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Members", directory.data?.employees.length ?? 0],
          ["Teams", teams.data?.length ?? 0],
          ["Guest shares", guests.data?.length ?? 0],
          ["Roles", roles.data?.length ?? 0],
        ].map(([label, value]) => (
          <div key={label} className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
              {label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <nav
        className="flex flex-wrap gap-2"
        aria-label="Work administration sections"
      >
        {visibleTabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`rounded-full px-4 py-2 text-sm ${tab === key ? "bg-ochre text-white" : "border border-sand bg-white"}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "organization" && enabled.has("work.domain_controls") ? (
        <OrganizationPanel
          policy={policy.data}
          onSaved={() => utils.workAdmin.policy.get.invalidate()}
        />
      ) : null}
      {tab === "teams" && enabled.has("work.teams") ? (
        <TeamsPanel
          teams={teams.data ?? []}
          employees={directory.data?.employees ?? []}
          projects={directory.data?.projects ?? []}
          messagePermissionsEnabled={enabled.has(
            "work.team_message_permissions",
          )}
          refresh={() => utils.workAdmin.teams.list.invalidate()}
        />
      ) : null}
      {tab === "guests" && enabled.has("work.guests") ? (
        <GuestsPanel
          guests={guests.data ?? []}
          clients={directory.data?.clients ?? []}
          projects={directory.data?.projects ?? []}
          refresh={async () => {
            await Promise.all([
              utils.workAdmin.guests.list.invalidate(),
              utils.workAdmin.directory.invalidate(),
            ]);
          }}
        />
      ) : null}
      {tab === "members" && enabled.has("work.view_only") ? (
        <MembersPanel
          members={members.data ?? []}
          refresh={() => utils.workAdmin.members.list.invalidate()}
        />
      ) : null}
      {tab === "roles" && enabled.has("work.custom_rbac") ? (
        <RolesPanel
          roles={roles.data ?? []}
          employees={directory.data?.employees ?? []}
          refresh={() => utils.workAdmin.rbac.list.invalidate()}
        />
      ) : null}
      {tab === "identity" && enabled.has("work.sso_scim") ? (
        <IdentityPanel
          identity={identity.data}
          refresh={() => utils.workAdmin.identity.get.invalidate()}
        />
      ) : null}
      {tab === "sandboxes" && enabled.has("work.sandboxes") ? (
        <SandboxesPanel
          configuration={sandboxes.data}
          refresh={() => utils.workAdmin.sandboxes.get.invalidate()}
        />
      ) : null}
      {tab === "api" && enabled.has("work.api_webhooks") ? (
        <ApiWebhooksPanel
          configuration={apiWebhooks.data}
          projects={directory.data?.projects ?? []}
          mcpEnabled={enabled.has("work.ai.connectors")}
          refresh={() => utils.workAdmin.apiWebhooks.get.invalidate()}
        />
      ) : null}
      {tab === "ai" && anyAiEnabled ? (
        <AiGovernancePanel
          configuration={aiGovernance.data}
          refresh={() => utils.workAdmin.aiGovernance.get.invalidate()}
        />
      ) : null}
      {tab === "exports" ? (
        <ExportsPanel
          auditEnabled={enabled.has("work.audit_export")}
          dataEnabled={enabled.has("work.data_export")}
        />
      ) : null}
    </main>
  );
}

function SandboxesPanel({
  configuration,
  refresh,
}: {
  configuration:
    | {
        environmentKind: "production" | "sandbox";
        configurationReady: boolean;
        configuredBaseUrl: string | null;
        sandbox: {
          sandboxId: string;
          name: string;
          environmentId: string;
          baseUrl: string;
          status: "active" | "unreachable" | "deleted";
          settingsCopiedAt: string | null;
          lastVerifiedAt: string | null;
          deletedAt: string | null;
          createdAt: string;
        } | null;
      }
    | undefined;
  refresh: () => Promise<unknown>;
}) {
  const [name, setName] = useState("hrmny Work sandbox");
  const [confirmation, setConfirmation] = useState("");
  const activate = trpc.workAdmin.sandboxes.activate.useMutation({
    onSuccess: refresh,
  });
  const verify = trpc.workAdmin.sandboxes.verify.useMutation({
    onSuccess: refresh,
  });
  const remove = trpc.workAdmin.sandboxes.delete.useMutation({
    onSuccess: async () => {
      setConfirmation("");
      await refresh();
    },
  });
  const sandbox = configuration?.sandbox;
  const active = sandbox && sandbox.status !== "deleted";
  const error = activate.error ?? verify.error ?? remove.error;

  return (
    <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <div className={cardClass}>
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
          Separate environment
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold">
          Work sandbox
        </h2>
        <p className="mt-2 text-sm text-muted">
          The sandbox uses another application deployment and database. Global
          Feature Lab, role, and organization settings are copied; production
          work and connections are never copied.
        </p>
        {!configuration?.configurationReady ? (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            Configure the sandbox deployment URL and verification token before
            activating this feature.
          </p>
        ) : null}
        {configuration?.environmentKind === "sandbox" ? (
          <p className="mt-4 rounded-lg border border-sand bg-fog p-3 text-sm">
            You are already inside the sandbox. Return to production to manage
            its lifecycle.
          </p>
        ) : null}
        {!active && configuration?.environmentKind === "production" ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              activate.mutate({ name });
            }}
          >
            <label className="text-sm">
              <span className="mb-1 block font-medium">Sandbox name</span>
              <input
                className={inputClass}
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button
              className="rounded-lg bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
              type="submit"
              disabled={
                activate.isPending ||
                !configuration.configurationReady ||
                !name.trim()
              }
            >
              {activate.isPending
                ? "Verifying and activating…"
                : "Activate sandbox"}
            </button>
          </form>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-[var(--hrmny-danger)]">
            {error.message}
          </p>
        ) : null}
      </div>

      <div className={cardClass}>
        {active ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold">
                  {sandbox.name}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {sandbox.environmentId} · {sandbox.status}
                </p>
              </div>
              <a
                className="rounded-lg bg-ochre px-4 py-2 text-sm text-white"
                href={sandbox.baseUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open sandbox
              </a>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Settings copied</dt>
                <dd>
                  {sandbox.settingsCopiedAt
                    ? new Date(sandbox.settingsCopiedAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Isolation last verified</dt>
                <dd>
                  {sandbox.lastVerifiedAt
                    ? new Date(sandbox.lastVerifiedAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>
            <button
              className="mt-5 rounded-lg border border-sand px-4 py-2 text-sm"
              type="button"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
            >
              {verify.isPending ? "Verifying…" : "Verify isolation"}
            </button>
            <div className="mt-6 border-t border-sand pt-5">
              <h3 className="font-semibold text-[var(--hrmny-danger)]">
                Delete sandbox
              </h3>
              <p className="mt-1 text-sm text-muted">
                This permanently clears the separate sandbox database. It cannot
                affect production because the server re-verifies both
                environment and database identities first.
              </p>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">
                  Type DELETE SANDBOX to confirm
                </span>
                <input
                  className={inputClass}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <button
                className="mt-3 rounded-lg bg-[var(--hrmny-danger)] px-4 py-2 text-sm text-white disabled:opacity-50"
                type="button"
                disabled={remove.isPending || confirmation !== "DELETE SANDBOX"}
                onClick={() =>
                  remove.mutate({ confirmation: "DELETE SANDBOX" })
                }
              >
                {remove.isPending ? "Deleting…" : "Delete sandbox"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex min-h-48 items-center justify-center text-center text-sm text-muted">
            No active sandbox. Activation only succeeds after the target proves
            it is a migrated sandbox on a different database.
          </div>
        )}
      </div>
    </section>
  );
}

function OrganizationPanel({
  policy,
  onSaved,
}: {
  policy:
    | {
        approvedDomains: string[];
        defaultProjectPrivacy: "organization" | "private";
        defaultTeamPrivacy: "public" | "request" | "private";
        guestInvitePolicy: "admins" | "members" | "disabled";
        externalSharingEnabled: boolean;
        appPolicy: "allow_all" | "approved_only" | "disabled";
        sessionTimeoutMinutes: number;
      }
    | undefined;
  onSaved: () => Promise<unknown>;
}) {
  const [domains, setDomains] = useState("");
  const [projectPrivacy, setProjectPrivacy] = useState<
    "organization" | "private"
  >("organization");
  const [teamPrivacy, setTeamPrivacy] = useState<
    "public" | "request" | "private"
  >("request");
  const [guestPolicy, setGuestPolicy] = useState<
    "admins" | "members" | "disabled"
  >("admins");
  const [externalSharing, setExternalSharing] = useState(true);
  const [appPolicy, setAppPolicy] = useState<
    "allow_all" | "approved_only" | "disabled"
  >("approved_only");
  const [timeout, setTimeoutMinutes] = useState(720);
  const save = trpc.workAdmin.policy.save.useMutation({ onSuccess: onSaved });

  useEffect(() => {
    if (!policy) return;
    setDomains(policy.approvedDomains.join(", "));
    setProjectPrivacy(policy.defaultProjectPrivacy);
    setTeamPrivacy(policy.defaultTeamPrivacy);
    setGuestPolicy(policy.guestInvitePolicy);
    setExternalSharing(policy.externalSharingEnabled);
    setAppPolicy(policy.appPolicy);
    setTimeoutMinutes(policy.sessionTimeoutMinutes);
  }, [policy]);

  return (
    <section className={cardClass}>
      <h2 className="font-display text-xl font-semibold">
        Organization defaults
      </h2>
      <p className="mt-1 text-sm text-muted">
        These defaults apply to new work. Feature Lab remains the final switch
        for each client, role, and user.
      </p>
      <form
        className="mt-5 grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            approvedDomains: domains
              .split(",")
              .map((domain) => domain.trim())
              .filter(Boolean),
            defaultProjectPrivacy: projectPrivacy,
            defaultTeamPrivacy: teamPrivacy,
            guestInvitePolicy: guestPolicy,
            externalSharingEnabled: externalSharing,
            appPolicy,
            sessionTimeoutMinutes: timeout,
          });
        }}
      >
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block font-medium">
            Approved company domains
          </span>
          <input
            className={inputClass}
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            placeholder="hrmny.com, client.ae"
          />
        </label>
        <Select
          label="New project privacy"
          value={projectPrivacy}
          onChange={(value) =>
            setProjectPrivacy(value as typeof projectPrivacy)
          }
          options={["organization", "private"]}
        />
        <Select
          label="New team privacy"
          value={teamPrivacy}
          onChange={(value) => setTeamPrivacy(value as typeof teamPrivacy)}
          options={["public", "request", "private"]}
        />
        <Select
          label="Who may invite guests"
          value={guestPolicy}
          onChange={(value) => setGuestPolicy(value as typeof guestPolicy)}
          options={["admins", "members", "disabled"]}
        />
        <div className="text-sm">
          <Select
            label="Connected app policy"
            value={appPolicy}
            onChange={(value) => setAppPolicy(value as typeof appPolicy)}
            options={["allow_all", "approved_only", "disabled"]}
          />
          <p className="mt-1 text-xs text-muted">
            <strong>approved only</strong> is the default curated list.
            <strong> disabled</strong> blocks Work / Composio apps only —
            Google Workspace, Apollo, Hunter, and other first-party CRM
            connections stay available.
          </p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-medium">
            Session timeout (minutes)
          </span>
          <input
            className={inputClass}
            type="number"
            min={15}
            max={43200}
            value={timeout}
            onChange={(event) => setTimeoutMinutes(Number(event.target.value))}
          />
        </label>
        <label className="flex items-center gap-3 self-end rounded-lg border border-sand bg-white px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={externalSharing}
            onChange={(event) => setExternalSharing(event.target.checked)}
          />
          Allow external project sharing
        </label>
        <div className="md:col-span-2">
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="submit"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save organization policy"}
          </button>
          {save.error ? (
            <p className="mt-2 text-sm text-[var(--hrmny-danger)]">
              {save.error.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function TeamsPanel({
  teams,
  employees,
  projects,
  messagePermissionsEnabled,
  refresh,
}: {
  teams: any[];
  employees: any[];
  projects: any[];
  messagePermissionsEnabled: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "request" | "private">(
    "request",
  );
  const create = trpc.workAdmin.teams.create.useMutation({
    onSuccess: async () => {
      setName("");
      await refresh();
    },
  });
  const setMember = trpc.workAdmin.teams.setMember.useMutation({
    onSuccess: refresh,
  });
  const setProject = trpc.workAdmin.teams.setProject.useMutation({
    onSuccess: refresh,
  });
  const setMessagePermission =
    trpc.workAdmin.teams.setMessagePermission.useMutation({
      onSuccess: refresh,
    });
  const archive = trpc.workAdmin.teams.archive.useMutation({
    onSuccess: refresh,
  });
  return (
    <section className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
      <form
        className={cardClass}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim())
            create.mutate({ name: name.trim(), description: "", privacy });
        }}
      >
        <h2 className="font-display text-xl font-semibold">Create a team</h2>
        <input
          className={`${inputClass} mt-4`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Team name"
          maxLength={160}
        />
        <select
          className={`${inputClass} mt-3`}
          value={privacy}
          onChange={(event) => setPrivacy(event.target.value as typeof privacy)}
        >
          <option value="public">Public</option>
          <option value="request">Join by request</option>
          <option value="private">Private</option>
        </select>
        <button
          className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm text-white"
          type="submit"
        >
          Create team
        </button>
      </form>
      <div className="space-y-4">
        {teams.map((team) => (
          <article key={team.teamId} className={cardClass}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">
                  {team.name}
                </h3>
                <p className="text-xs uppercase tracking-wide text-muted">
                  {team.privacy} · {team.members.length} members ·{" "}
                  {team.projects.length} projects
                </p>
                {messagePermissionsEnabled ? (
                  <label className="mt-2 block text-xs text-muted">
                    Who can send team messages
                    <select
                      className="ml-2 rounded border border-sand bg-white px-2 py-1"
                      value={team.messageSendPermission}
                      onChange={(event) =>
                        setMessagePermission.mutate({
                          teamId: team.teamId,
                          permission: event.target.value as
                            "admins" | "members",
                        })
                      }
                    >
                      <option value="members">All members</option>
                      <option value="admins">Admins only</option>
                    </select>
                  </label>
                ) : null}
              </div>
              <button
                type="button"
                className="text-xs text-[var(--hrmny-danger)] underline"
                onClick={() => archive.mutate({ teamId: team.teamId })}
              >
                Archive
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                Add member
                <select
                  className={`${inputClass} mt-1`}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value)
                      setMember.mutate({
                        teamId: team.teamId,
                        employeeId: event.target.value,
                        role: "member",
                      });
                    event.currentTarget.value = "";
                  }}
                >
                  <option value="">Choose member</option>
                  {employees
                    .filter(
                      (employee) =>
                        !team.members.some(
                          (member: any) =>
                            member.employeeId === employee.employeeId,
                        ),
                    )
                    .map((employee) => (
                      <option
                        key={employee.employeeId}
                        value={employee.employeeId}
                      >
                        {employee.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                Add project
                <select
                  className={`${inputClass} mt-1`}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value)
                      setProject.mutate({
                        teamId: team.teamId,
                        projectId: event.target.value,
                        included: true,
                      });
                    event.currentTarget.value = "";
                  }}
                >
                  <option value="">Choose project</option>
                  {projects
                    .filter(
                      (project) =>
                        !team.projects.some(
                          (item: any) => item.projectId === project.projectId,
                        ),
                    )
                    .map((project) => (
                      <option key={project.projectId} value={project.projectId}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {team.members.map((member: any) => (
                <button
                  key={member.employeeId}
                  type="button"
                  className="rounded-full border border-sand bg-white px-3 py-1 text-xs"
                  onClick={() =>
                    setMember.mutate({
                      teamId: team.teamId,
                      employeeId: member.employeeId,
                      role: null,
                    })
                  }
                >
                  {member.displayName} · {member.role} ×
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {team.projects.map((project: any) => (
                <span
                  key={project.projectId}
                  className="inline-flex items-center gap-2 rounded-full border border-sand bg-white px-3 py-1 text-xs"
                >
                  {project.name}
                  <select
                    className="bg-transparent"
                    value={project.accessLevel ?? "editor"}
                    aria-label={`${project.name} team access`}
                    onChange={(event) =>
                      setProject.mutate({
                        teamId: team.teamId,
                        projectId: project.projectId,
                        included: true,
                        accessLevel: event.target.value as
                          "editor" | "commenter" | "viewer",
                      })
                    }
                  >
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove ${project.name} from team`}
                    onClick={() =>
                      setProject.mutate({
                        teamId: team.teamId,
                        projectId: project.projectId,
                        included: false,
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function GuestsPanel({
  guests,
  clients,
  projects,
  refresh,
}: {
  guests: any[];
  clients: any[];
  projects: any[];
  refresh: () => Promise<unknown>;
}) {
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accessLevel, setAccessLevel] = useState<"viewer" | "commenter">(
    "viewer",
  );
  const invite = trpc.workAdmin.guests.invite.useMutation({
    onSuccess: async () => {
      setEmail("");
      setDisplayName("");
      await refresh();
    },
  });
  const setAccess = trpc.workAdmin.guests.setAccess.useMutation({
    onSuccess: refresh,
  });
  const revoke = trpc.workAdmin.guests.revoke.useMutation({
    onSuccess: refresh,
  });
  return (
    <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
      <form
        className={cardClass}
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate({
            clientId,
            projectId,
            email,
            displayName,
            accessLevel,
          });
        }}
      >
        <h2 className="font-display text-xl font-semibold">Share a project</h2>
        <p className="mt-1 text-sm text-muted">
          The guest can only open the selected project.
        </p>
        <div className="mt-4 space-y-3">
          <select
            required
            className={inputClass}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">Client</option>
            {clients.map((client) => (
              <option key={client.clientId} value={client.clientId}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            required
            className={inputClass}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Project</option>
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.name}
              </option>
            ))}
          </select>
          <input
            required
            className={inputClass}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Guest email"
          />
          <input
            required
            className={inputClass}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Guest name"
          />
          <select
            className={inputClass}
            value={accessLevel}
            onChange={(event) =>
              setAccessLevel(event.target.value as typeof accessLevel)
            }
          >
            <option value="viewer">Can view</option>
            <option value="commenter">Can comment</option>
          </select>
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="submit"
            disabled={invite.isPending}
          >
            Share project
          </button>
          {invite.error ? (
            <p className="text-sm text-[var(--hrmny-danger)]">
              {invite.error.message}
            </p>
          ) : null}
        </div>
      </form>
      <div className="space-y-3">
        {guests.map((guest) => (
          <article
            key={`${guest.projectId}:${guest.portalUserId}`}
            className={cardClass}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">{guest.displayName}</h3>
                <p className="text-sm text-muted">
                  {guest.email} · {guest.projectName ?? guest.projectId}
                </p>
              </div>
              <div className="flex gap-2">
                <select
                  className="rounded-lg border border-sand bg-white px-2 py-1 text-sm"
                  value={guest.accessLevel}
                  onChange={(event) =>
                    setAccess.mutate({
                      projectId: guest.projectId,
                      portalUserId: guest.portalUserId,
                      accessLevel: event.target.value as "viewer" | "commenter",
                    })
                  }
                >
                  <option value="viewer">Viewer</option>
                  <option value="commenter">Commenter</option>
                </select>
                <button
                  type="button"
                  className="text-xs text-[var(--hrmny-danger)] underline"
                  onClick={() =>
                    revoke.mutate({
                      projectId: guest.projectId,
                      portalUserId: guest.portalUserId,
                    })
                  }
                >
                  Revoke
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MembersPanel({
  members,
  refresh,
}: {
  members: any[];
  refresh: () => Promise<unknown>;
}) {
  const setLicense = trpc.workAdmin.members.setLicense.useMutation({
    onSuccess: refresh,
  });
  return (
    <section className={cardClass}>
      <h2 className="font-display text-xl font-semibold">Workspace licenses</h2>
      <p className="mt-1 text-sm text-muted">
        View-only members can read accessible work but all Work mutations are
        denied at the server.
      </p>
      <div className="mt-4 divide-y divide-sand">
        {members.map((member) => (
          <div
            key={member.employeeId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <p className="font-medium">{member.displayName}</p>
              <p className="text-sm text-muted">{member.email}</p>
            </div>
            <select
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              value={member.licenseType}
              onChange={(event) =>
                setLicense.mutate({
                  employeeId: member.employeeId,
                  licenseType: event.target.value as "full" | "view_only",
                })
              }
            >
              <option value="full">Full member</option>
              <option value="view_only">View only</option>
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}

function RolesPanel({
  roles,
  employees,
  refresh,
}: {
  roles: any[];
  employees: any[];
  refresh: () => Promise<unknown>;
}) {
  const [roleKey, setRoleKey] = useState("");
  const [roleName, setRoleName] = useState("");
  const [selected, setSelected] = useState("");
  const [resource, setResource] = useState("work");
  const [action, setAction] = useState("view");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");
  const create = trpc.workAdmin.rbac.createRole.useMutation({
    onSuccess: async (role) => {
      setSelected(role.key);
      setRoleKey("");
      setRoleName("");
      await refresh();
    },
  });
  const setPermission = trpc.workAdmin.rbac.setPermission.useMutation({
    onSuccess: refresh,
  });
  const setMember = trpc.workAdmin.rbac.setMember.useMutation({
    onSuccess: refresh,
  });
  const current = roles.find((role) => role.key === selected) ?? roles[0];
  useEffect(() => {
    if (!selected && roles[0]) setSelected(roles[0].key);
  }, [roles, selected]);
  return (
    <section className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
      <form
        className={cardClass}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ key: roleKey, displayName: roleName });
        }}
      >
        <h2 className="font-display text-xl font-semibold">Create a role</h2>
        <input
          className={`${inputClass} mt-4`}
          value={roleName}
          onChange={(event) => setRoleName(event.target.value)}
          placeholder="Role name"
        />
        <input
          className={`${inputClass} mt-3`}
          value={roleKey}
          onChange={(event) =>
            setRoleKey(event.target.value.toLowerCase().replaceAll(" ", "_"))
          }
          placeholder="role_key"
        />
        <button
          className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm text-white"
          type="submit"
        >
          Create role
        </button>
      </form>
      <div className={cardClass}>
        <select
          className={inputClass}
          value={current?.key ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.displayName}
            </option>
          ))}
        </select>
        {current ? (
          <>
            <h3 className="mt-5 font-display text-lg font-semibold">
              Permissions
            </h3>
            <form
              className="mt-2 grid gap-2 sm:grid-cols-4"
              onSubmit={(event) => {
                event.preventDefault();
                setPermission.mutate({
                  roleKey: current.key,
                  resource,
                  action,
                  effect,
                });
              }}
            >
              <input
                className={inputClass}
                value={resource}
                onChange={(event) => setResource(event.target.value)}
                placeholder="Resource"
              />
              <input
                className={inputClass}
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder="Action"
              />
              <select
                className={inputClass}
                value={effect}
                onChange={(event) =>
                  setEffect(event.target.value as typeof effect)
                }
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
              <button
                className="rounded-lg bg-ink px-3 py-2 text-sm text-white"
                type="submit"
              >
                Add
              </button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {current.policies.map((policy: any) => (
                <button
                  key={`${policy.resource}:${policy.action}`}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs ${policy.effect === "deny" ? "border-red-200 bg-red-50" : "border-sand bg-white"}`}
                  onClick={() =>
                    setPermission.mutate({
                      roleKey: current.key,
                      resource: policy.resource,
                      action: policy.action,
                      effect: null,
                    })
                  }
                >
                  {policy.effect} · {policy.resource}:{policy.action} ×
                </button>
              ))}
            </div>
            <h3 className="mt-5 font-display text-lg font-semibold">Members</h3>
            <select
              className={`${inputClass} mt-2`}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value)
                  setMember.mutate({
                    roleKey: current.key,
                    employeeId: event.target.value,
                    assigned: true,
                  });
                event.currentTarget.value = "";
              }}
            >
              <option value="">Assign member</option>
              {employees
                .filter(
                  (employee) =>
                    !current.members.some(
                      (member: any) =>
                        (member.employeeId ?? member) === employee.employeeId,
                    ),
                )
                .map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayName}
                  </option>
                ))}
            </select>
            <div className="mt-3 flex flex-wrap gap-2">
              {current.members.map((member: any) => {
                const id = member.employeeId ?? member;
                return (
                  <button
                    key={id}
                    type="button"
                    className="rounded-full border border-sand bg-white px-3 py-1 text-xs"
                    onClick={() =>
                      setMember.mutate({
                        roleKey: current.key,
                        employeeId: id,
                        assigned: false,
                      })
                    }
                  >
                    {member.displayName ??
                      employees.find((employee) => employee.employeeId === id)
                        ?.displayName ??
                      id}{" "}
                    ×
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function IdentityPanel({
  identity,
  refresh,
}: {
  identity:
    | {
        sso: {
          status: "disabled" | "optional" | "enforced";
          providerId: string | null;
          metadataUrl: string | null;
          domains: string[];
          breakGlassEmails: string[];
        };
        scimTokens: {
          tokenId: string;
          label: string;
          expiresAt: string | null;
          lastUsedAt: string | null;
          revokedAt: string | null;
        }[];
        serviceProvider: {
          entityId: string;
          metadataUrl: string;
          acsUrl: string;
          scimBaseUrl: string;
        } | null;
      }
    | undefined;
  refresh: () => Promise<unknown>;
}) {
  const [status, setStatus] = useState<"disabled" | "optional" | "enforced">(
    "disabled",
  );
  const [providerId, setProviderId] = useState("");
  const [metadataUrl, setMetadataUrl] = useState("");
  const [domains, setDomains] = useState("");
  const [breakGlass, setBreakGlass] = useState("");
  const [tokenLabel, setTokenLabel] = useState("Identity provider");
  const [tokenExpiresOn, setTokenExpiresOn] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 90);
    return date.toISOString().slice(0, 10);
  });
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const save = trpc.workAdmin.identity.saveSso.useMutation({
    onSuccess: refresh,
  });
  const issue = trpc.workAdmin.identity.issueScimToken.useMutation({
    onSuccess: async (result) => {
      setIssuedToken(result.token);
      await refresh();
    },
  });
  const revoke = trpc.workAdmin.identity.revokeScimToken.useMutation({
    onSuccess: refresh,
  });

  useEffect(() => {
    if (!identity) return;
    setStatus(identity.sso.status);
    setProviderId(identity.sso.providerId ?? "");
    setMetadataUrl(identity.sso.metadataUrl ?? "");
    setDomains(identity.sso.domains.join(", "));
    setBreakGlass(identity.sso.breakGlassEmails.join(", "));
  }, [identity]);

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <form
        className={cardClass}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            status,
            providerId: providerId.trim() || null,
            metadataUrl: metadataUrl.trim() || null,
            domains: domains
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            breakGlassEmails: breakGlass
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          });
        }}
      >
        <h2 className="font-display text-xl font-semibold">SAML SSO</h2>
        <p className="mt-1 text-sm text-muted">
          Register the identity provider in Supabase, then enforce its provider
          ID for selected company domains.
        </p>
        <div className="mt-4 space-y-3">
          <Select
            label="Policy"
            value={status}
            onChange={(value) => setStatus(value as typeof status)}
            options={["disabled", "optional", "enforced"]}
          />
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Supabase SSO provider ID
            </span>
            <input
              className={inputClass}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              placeholder="Provider UUID"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Identity provider metadata URL
            </span>
            <input
              className={inputClass}
              type="url"
              value={metadataUrl}
              onChange={(event) => setMetadataUrl(event.target.value)}
              placeholder="https://idp.example.com/metadata"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Enforced domains</span>
            <input
              className={inputClass}
              value={domains}
              onChange={(event) => setDomains(event.target.value)}
              placeholder="hrmny.com"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Break-glass administrator emails
            </span>
            <input
              className={inputClass}
              value={breakGlass}
              onChange={(event) => setBreakGlass(event.target.value)}
              placeholder="owner@hrmny.com"
            />
          </label>
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="submit"
            disabled={save.isPending}
          >
            Save SSO policy
          </button>
          {save.error ? (
            <p className="text-sm text-[var(--hrmny-danger)]">
              {save.error.message}
            </p>
          ) : null}
        </div>
        {identity?.serviceProvider ? (
          <dl className="mt-5 space-y-2 rounded-lg border border-sand bg-white p-3 text-xs">
            <div>
              <dt className="font-semibold">Entity ID / metadata</dt>
              <dd className="break-all text-muted">
                {identity.serviceProvider.metadataUrl}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Assertion consumer URL</dt>
              <dd className="break-all text-muted">
                {identity.serviceProvider.acsUrl}
              </dd>
            </div>
          </dl>
        ) : null}
      </form>

      <div className={cardClass}>
        <h2 className="font-display text-xl font-semibold">
          SCIM 2.0 provisioning
        </h2>
        <p className="mt-1 text-sm text-muted">
          Issue a bearer token to your identity provider for Users and Groups.
          Tokens are stored only as hashes and shown once.
        </p>
        {identity?.serviceProvider ? (
          <p className="mt-3 break-all rounded-lg border border-sand bg-white p-3 text-xs">
            Base URL: {identity.serviceProvider.scimBaseUrl}
          </p>
        ) : null}
        <form
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            issue.mutate({
              label: tokenLabel,
              expiresAt: tokenExpiresOn
                ? new Date(`${tokenExpiresOn}T23:59:59.999Z`).toISOString()
                : null,
            });
          }}
        >
          <input
            className={inputClass}
            value={tokenLabel}
            onChange={(event) => setTokenLabel(event.target.value)}
            maxLength={120}
          />
          <input
            className={inputClass}
            type="date"
            aria-label="Token expiry date"
            value={tokenExpiresOn}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setTokenExpiresOn(event.target.value)}
          />
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="submit"
            disabled={issue.isPending}
          >
            {issue.isPending ? "Issuing…" : "Issue"}
          </button>
        </form>
        {issuedToken ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-semibold">
              Copy this token now. It will not be shown again.
            </p>
            <code className="mt-2 block break-all text-xs">{issuedToken}</code>
            <button
              className="mt-2 text-xs underline"
              type="button"
              onClick={() => void navigator.clipboard.writeText(issuedToken)}
            >
              Copy token
            </button>
          </div>
        ) : null}
        {issue.error ? (
          <p className="mt-2 text-sm text-[var(--hrmny-danger)]">
            {issue.error.message}
          </p>
        ) : null}
        <div className="mt-5 divide-y divide-sand">
          {(identity?.scimTokens ?? []).map((token) => (
            <div
              key={token.tokenId}
              className="flex items-center justify-between gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{token.label}</p>
                <p className="text-xs text-muted">
                  {token.revokedAt
                    ? "Revoked"
                    : token.lastUsedAt
                      ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                      : "Never used"}
                </p>
                {token.expiresAt ? (
                  <p className="text-xs text-muted">
                    Expires {new Date(token.expiresAt).toLocaleDateString()}
                  </p>
                ) : null}
              </div>
              {!token.revokedAt ? (
                <button
                  type="button"
                  className="text-xs text-[var(--hrmny-danger)] underline"
                  onClick={() => revoke.mutate({ tokenId: token.tokenId })}
                >
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AiGovernancePanel({
  configuration,
  refresh,
}: {
  configuration:
    | {
        policy: {
          model: string | null;
          monthlyTokenLimit: number;
          dailyUserRequestLimit: number;
          retentionDays: number;
          requireHumanApproval: boolean;
        };
        usage: {
          requests: number;
          inputTokens: number;
          outputTokens: number;
          byUser: Array<{
            employeeId: string;
            displayName: string;
            requests: number;
            tokens: number;
          }>;
        };
      }
    | undefined;
  refresh: () => Promise<unknown>;
}) {
  const [model, setModel] = useState("");
  const [monthlyTokens, setMonthlyTokens] = useState(1_000_000);
  const [dailyRequests, setDailyRequests] = useState(100);
  const [retentionDays, setRetentionDays] = useState(30);
  const save = trpc.workAdmin.aiGovernance.save.useMutation({
    onSuccess: refresh,
  });

  useEffect(() => {
    if (!configuration) return;
    setModel(configuration.policy.model ?? "");
    setMonthlyTokens(configuration.policy.monthlyTokenLimit);
    setDailyRequests(configuration.policy.dailyUserRequestLimit);
    setRetentionDays(configuration.policy.retentionDays);
  }, [configuration]);

  const usedTokens =
    (configuration?.usage.inputTokens ?? 0) +
    (configuration?.usage.outputTokens ?? 0);

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <form
        className={cardClass}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            model: model.trim() || null,
            monthlyTokenLimit: monthlyTokens,
            dailyUserRequestLimit: dailyRequests,
            retentionDays,
            requireHumanApproval: true,
          });
        }}
      >
        <h2 className="font-display text-xl font-semibold">AI guardrails</h2>
        <p className="mt-1 text-sm text-muted">
          Feature Lab decides who can use each capability. These limits govern
          model selection, consumption, retention, and human review.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Model</span>
            <input
              className={inputClass}
              value={model}
              maxLength={200}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Uses LLM_DEFAULT_MODEL when blank"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Monthly token limit</span>
            <input
              className={inputClass}
              type="number"
              min={1_000}
              max={1_000_000_000}
              value={monthlyTokens}
              onChange={(event) => setMonthlyTokens(Number(event.target.value))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Daily requests per user
            </span>
            <input
              className={inputClass}
              type="number"
              min={1}
              max={10_000}
              value={dailyRequests}
              onChange={(event) => setDailyRequests(Number(event.target.value))}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              AI history retention (days)
            </span>
            <input
              className={inputClass}
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(event) => setRetentionDays(Number(event.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked disabled />
            Explicit human approval is required before every AI change
          </label>
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="submit"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save AI policy"}
          </button>
          {save.error ? (
            <p role="alert" className="text-sm text-[var(--hrmny-danger)]">
              {save.error.message}
            </p>
          ) : null}
        </div>
      </form>

      <div className={cardClass}>
        <h2 className="font-display text-xl font-semibold">
          This month&apos;s usage
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-sand bg-white p-3">
            <p className="text-xs text-muted">Requests</p>
            <p className="mt-1 font-display text-2xl font-semibold">
              {configuration?.usage.requests ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-sand bg-white p-3">
            <p className="text-xs text-muted">Tokens</p>
            <p className="mt-1 font-display text-2xl font-semibold">
              {usedTokens.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-sand">
          <div
            className="h-full bg-ochre"
            style={{
              width: `${Math.min(100, (usedTokens / Math.max(monthlyTokens, 1)) * 100)}%`,
            }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {usedTokens.toLocaleString()} of {monthlyTokens.toLocaleString()}{" "}
          tokens
        </p>
        <div className="mt-5 divide-y divide-sand">
          {(configuration?.usage.byUser ?? []).map((user) => (
            <div
              key={user.employeeId}
              className="flex justify-between gap-3 py-3 text-sm"
            >
              <span>{user.displayName}</span>
              <span className="text-muted">
                {user.requests} requests · {user.tokens.toLocaleString()} tokens
              </span>
            </div>
          ))}
          {!configuration?.usage.byUser.length ? (
            <p className="py-3 text-sm text-muted">No AI usage this month.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const workApiScopes = [
  "projects:read",
  "projects:write",
  "tasks:read",
  "tasks:write",
  "comments:read",
  "comments:write",
] as const;
const workWebhookEvents = [
  "project.created",
  "project.updated",
  "task.created",
  "task.updated",
  "task.moved",
  "task.removed",
  "comment.created",
  "rule.triggered",
] as const;

function ApiWebhooksPanel({
  configuration,
  projects,
  mcpEnabled,
  refresh,
}: {
  configuration:
    | {
        tokens: Array<{
          tokenId: string;
          label: string;
          tokenPrefix: string;
          scopes: string[];
          expiresAt: string | null;
          lastUsedAt: string | null;
          revokedAt: string | null;
        }>;
        webhooks: Array<{
          subscriptionId: string;
          projectId: string;
          projectName: string;
          name: string;
          targetUrl: string;
          eventTypes: string[];
          status: string;
        }>;
        deliveries: Array<{
          deliveryId: string;
          subscriptionName: string;
          eventType: string;
          status: string;
          attempts: number;
          responseStatus: number | null;
          lastError: string | null;
          createdAt: string;
        }>;
      }
    | undefined;
  projects: Array<{ projectId: string; name: string }>;
  mcpEnabled: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [tokenLabel, setTokenLabel] = useState("Automation token");
  const [expiresOn, setExpiresOn] = useState("");
  const [scopes, setScopes] = useState<string[]>([
    "projects:read",
    "tasks:read",
    "comments:read",
  ]);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [webhookName, setWebhookName] = useState("Project automation");
  const [projectId, setProjectId] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [eventTypes, setEventTypes] = useState<string[]>([
    "task.created",
    "task.updated",
  ]);
  const issue = trpc.workAdmin.apiWebhooks.issueToken.useMutation({
    onSuccess: async (result) => {
      setIssuedToken(result.token);
      await refresh();
    },
  });
  const revoke = trpc.workAdmin.apiWebhooks.revokeToken.useMutation({
    onSuccess: refresh,
  });
  const createWebhook = trpc.workAdmin.apiWebhooks.createWebhook.useMutation({
    onSuccess: async (result) => {
      setWebhookSecret(result.secret);
      setTargetUrl("");
      await refresh();
    },
  });
  const deleteWebhook = trpc.workAdmin.apiWebhooks.deleteWebhook.useMutation({
    onSuccess: refresh,
  });

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].projectId);
  }, [projectId, projects]);

  const toggle = (
    values: string[],
    value: string,
    set: (next: string[]) => void,
  ) =>
    set(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value],
    );

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className={cardClass}>
        <h2 className="font-display text-xl font-semibold">
          Scoped API tokens
        </h2>
        <p className="mt-1 text-sm text-muted">
          Tokens act as their owner and keep that person&apos;s current project
          permissions. Secrets are stored only as hashes and shown once.
        </p>
        {mcpEnabled ? (
          <div className="mt-3 rounded-lg border border-sand bg-white p-3 text-sm">
            <p className="font-medium">AI client connection</p>
            <p className="mt-1 text-muted">
              Use a token from this section as a Bearer token. Available tools
              match its scopes and the owner&apos;s live permissions.
            </p>
            <code className="mt-2 block break-all text-xs">/api/mcp/work</code>
          </div>
        ) : null}
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            issue.mutate({
              label: tokenLabel,
              scopes: scopes as (typeof workApiScopes)[number][],
              expiresAt: expiresOn
                ? new Date(`${expiresOn}T23:59:59.999Z`).toISOString()
                : null,
            });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input
                className={inputClass}
                value={tokenLabel}
                maxLength={120}
                onChange={(event) => setTokenLabel(event.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Expiry (optional)</span>
              <input
                className={inputClass}
                type="date"
                value={expiresOn}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
            </label>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Scopes</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {workApiScopes.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggle(scopes, scope, setScopes)}
                  />
                  {scope}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="submit"
            disabled={issue.isPending || !scopes.length}
          >
            {issue.isPending ? "Issuing…" : "Issue token"}
          </button>
        </form>
        {issuedToken ? (
          <OneTimeSecret label="Copy this API token now" value={issuedToken} />
        ) : null}
        {issue.error ? (
          <p className="mt-2 text-sm text-[var(--hrmny-danger)]">
            {issue.error.message}
          </p>
        ) : null}
        <div className="mt-5 divide-y divide-sand">
          {(configuration?.tokens ?? []).map((token) => (
            <div
              key={token.tokenId}
              className="flex items-start justify-between gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {token.label} · <code>{token.tokenPrefix}…</code>
                </p>
                <p className="text-xs text-muted">{token.scopes.join(", ")}</p>
                <p className="text-xs text-muted">
                  {token.revokedAt
                    ? "Revoked"
                    : token.lastUsedAt
                      ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                      : "Never used"}
                  {token.expiresAt
                    ? ` · expires ${new Date(token.expiresAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              {!token.revokedAt ? (
                <button
                  type="button"
                  className="text-xs text-[var(--hrmny-danger)] underline"
                  onClick={() => revoke.mutate({ tokenId: token.tokenId })}
                >
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="font-display text-xl font-semibold">Signed webhooks</h2>
        <p className="mt-1 text-sm text-muted">
          Send project events to a public HTTPS endpoint. Delivery access is
          rechecked and failed calls retry automatically.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            createWebhook.mutate({
              projectId,
              name: webhookName,
              targetUrl,
              eventTypes: eventTypes as (typeof workWebhookEvents)[number][],
            });
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input
              className={inputClass}
              value={webhookName}
              maxLength={120}
              onChange={(event) => setWebhookName(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Project</span>
            <select
              className={inputClass}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Destination URL</span>
            <input
              className={inputClass}
              type="url"
              required
              value={targetUrl}
              placeholder="https://automation.example.com/hrmny"
              onChange={(event) => setTargetUrl(event.target.value)}
            />
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Events</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {workWebhookEvents.map((eventType) => (
                <label
                  key={eventType}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={eventTypes.includes(eventType)}
                    onChange={() =>
                      toggle(eventTypes, eventType, setEventTypes)
                    }
                  />
                  {eventType}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="submit"
            disabled={
              createWebhook.isPending || !projectId || !eventTypes.length
            }
          >
            {createWebhook.isPending ? "Creating…" : "Create webhook"}
          </button>
        </form>
        {webhookSecret ? (
          <OneTimeSecret
            label="Copy this signing secret now"
            value={webhookSecret}
          />
        ) : null}
        {createWebhook.error ? (
          <p className="mt-2 text-sm text-[var(--hrmny-danger)]">
            {createWebhook.error.message}
          </p>
        ) : null}
        <div className="mt-5 divide-y divide-sand">
          {(configuration?.webhooks ?? []).map((webhook) => (
            <div
              key={webhook.subscriptionId}
              className="flex items-start justify-between gap-3 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {webhook.name} · {webhook.projectName}
                </p>
                <p className="truncate text-xs text-muted">
                  {webhook.targetUrl}
                </p>
                <p className="text-xs text-muted">
                  {webhook.eventTypes.join(", ")}
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-[var(--hrmny-danger)] underline"
                onClick={() =>
                  deleteWebhook.mutate({
                    subscriptionId: webhook.subscriptionId,
                  })
                }
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={`${cardClass} xl:col-span-2`}>
        <h2 className="font-display text-xl font-semibold">
          Recent deliveries
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sand text-xs text-muted">
                <th className="py-2">Webhook</th>
                <th>Event</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {(configuration?.deliveries ?? []).map((delivery) => (
                <tr
                  key={delivery.deliveryId}
                  className="border-b border-sand/70"
                >
                  <td className="py-2">{delivery.subscriptionName}</td>
                  <td>{delivery.eventType}</td>
                  <td>
                    {delivery.status}
                    {delivery.responseStatus
                      ? ` (${delivery.responseStatus})`
                      : ""}
                  </td>
                  <td>{delivery.attempts}</td>
                  <td>{new Date(delivery.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function OneTimeSecret({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-semibold">
        {label}. It will not be shown again.
      </p>
      <code className="mt-2 block break-all text-xs">{value}</code>
      <button
        className="mt-2 text-xs underline"
        type="button"
        onClick={() => void navigator.clipboard.writeText(value)}
      >
        Copy
      </button>
    </div>
  );
}

function ExportsPanel({
  auditEnabled,
  dataEnabled,
}: {
  auditEnabled: boolean;
  dataEnabled: boolean;
}) {
  const audit = trpc.workAdmin.export.audit.useQuery(
    { limit: 1000 },
    { enabled: false },
  );
  const organization = trpc.workAdmin.export.organization.useQuery(undefined, {
    enabled: false,
  });
  return (
    <section className="grid gap-4 md:grid-cols-2">
      {auditEnabled ? (
        <div className={cardClass}>
          <h2 className="font-display text-xl font-semibold">Audit export</h2>
          <p className="mt-1 text-sm text-muted">
            Download the latest 1,000 immutable audit events as CSV for
            compliance or SIEM review.
          </p>
          <button
            className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="button"
            onClick={async () => {
              const result = await audit.refetch();
              if (result.data) download(result.data);
            }}
          >
            Download audit CSV
          </button>
        </div>
      ) : null}
      {dataEnabled ? (
        <div className={cardClass}>
          <h2 className="font-display text-xl font-semibold">Work backup</h2>
          <p className="mt-1 text-sm text-muted">
            Download the complete Work graph, governance settings, memberships,
            and project history as JSON.
          </p>
          <button
            className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm text-white"
            type="button"
            onClick={async () => {
              const result = await organization.refetch();
              if (result.data) download(result.data);
            }}
          >
            Download Work backup
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <select
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
