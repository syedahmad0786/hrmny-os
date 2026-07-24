"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type Tab =
  "organization" | "teams" | "guests" | "members" | "roles" | "exports";

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

  const tabs = [
    ["organization", "Organization", "work.domain_controls"],
    ["teams", "Teams", "work.teams"],
    ["guests", "Guests", "work.guests"],
    ["members", "Members", "work.view_only"],
    ["roles", "Roles", "work.custom_rbac"],
    ["exports", "Exports", "work.data_export"],
  ] as const;
  const visibleTabs = tabs.filter(([, , feature]) =>
    feature === "work.data_export"
      ? enabled.has("work.data_export") || enabled.has("work.audit_export")
      : enabled.has(feature),
  );

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
      {tab === "exports" ? (
        <ExportsPanel
          auditEnabled={enabled.has("work.audit_export")}
          dataEnabled={enabled.has("work.data_export")}
        />
      ) : null}
    </main>
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
        <Select
          label="Connected app policy"
          value={appPolicy}
          onChange={(value) => setAppPolicy(value as typeof appPolicy)}
          options={["allow_all", "approved_only", "disabled"]}
        />
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
  refresh,
}: {
  teams: any[];
  employees: any[];
  projects: any[];
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
