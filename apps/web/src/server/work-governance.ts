import { sql } from "@hrmny/db";
import { getDb } from "./db";
import { getDemoStore } from "./demo-store";

export type WorkAppPolicy = "allow_all" | "approved_only" | "disabled";

export type WorkOrganizationPolicy = {
  approvedDomains: string[];
  defaultProjectPrivacy: "organization" | "private";
  defaultTeamPrivacy: "public" | "request" | "private";
  guestInvitePolicy: "admins" | "members" | "disabled";
  externalSharingEnabled: boolean;
  appPolicy: WorkAppPolicy;
  sessionTimeoutMinutes: number;
  updatedAt: string;
};

export type DemoGuestShare = {
  shareId: string;
  projectId: string;
  portalUserId: string;
  clientId: string;
  email: string;
  displayName: string;
  accessLevel: "commenter" | "viewer";
  invitedByEmployeeId: string;
  updatedAt: string;
};

const defaultPolicy = (): WorkOrganizationPolicy => ({
  approvedDomains: [],
  defaultProjectPrivacy: "organization",
  defaultTeamPrivacy: "request",
  guestInvitePolicy: "admins",
  externalSharingEnabled: true,
  appPolicy: "approved_only",
  sessionTimeoutMinutes: 720,
  updatedAt: new Date(0).toISOString(),
});

const SYSTEM_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000000";

let demoPolicy = defaultPolicy();
const demoLicenses = new Map<string, "full" | "view_only">();
const demoGuestShares = new Map<string, DemoGuestShare>();
const CURATED_WORK_APPS = new Set([
  "apollo",
  "adobe",
  "asana",
  "bayzat",
  "box",
  "canva",
  "calendar",
  "composio",
  "dropbox",
  "gmail",
  "googledrive",
  "google_workspace",
  "hunter",
  "jira",
  "linkedin",
  "microsoft_teams",
  "n8n",
  "one_drive",
  "outlook",
  "power_bi",
  "salesforce",
  "servicenow",
  "slack",
  "xero",
  "zoom",
]);

/**
 * First-party CRM / Sales OS connections. Work `app_policy = disabled` is a
 * kill-switch for Composio / Work apps — it must not grey out mailbox or
 * enrichment Connect buttons.
 */
export const FIRST_PARTY_CRM_APPS = new Set([
  "google_workspace",
  "apollo",
  "hunter",
  "n8n",
  "bayzat",
  "asana",
  "canva",
  "linkedin",
  "xero",
]);

export function normalizeAppPolicy(value: unknown): WorkAppPolicy {
  if (value === "allow_all" || value === "approved_only" || value === "disabled") {
    return value;
  }
  return "approved_only";
}

export function isFirstPartyCrmApp(toolkit: string) {
  return FIRST_PARTY_CRM_APPS.has(toolkit.trim().toLowerCase());
}

export function normalizeDomains(domains: readonly string[]) {
  return [...new Set(domains.map((domain) => domain.trim().toLowerCase()))]
    .filter((domain) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain))
    .sort();
}

export async function getWorkOrganizationPolicy(): Promise<WorkOrganizationPolicy> {
  const db = getDb();
  if (!db) return demoPolicy;
  try {
    const rows = await db.execute<{
      approvedDomains: unknown;
      approved_domains?: unknown;
      defaultProjectPrivacy: WorkOrganizationPolicy["defaultProjectPrivacy"];
      defaultTeamPrivacy: WorkOrganizationPolicy["defaultTeamPrivacy"];
      guestInvitePolicy: WorkOrganizationPolicy["guestInvitePolicy"];
      externalSharingEnabled: boolean;
      appPolicy?: unknown;
      app_policy?: unknown;
      sessionTimeoutMinutes: number;
      updatedAt: Date | string;
    }>(sql`
      select approved_domains as "approvedDomains",
        default_project_privacy as "defaultProjectPrivacy",
        default_team_privacy as "defaultTeamPrivacy",
        guest_invite_policy as "guestInvitePolicy",
        external_sharing_enabled as "externalSharingEnabled",
        app_policy as "appPolicy",
        session_timeout_minutes as "sessionTimeoutMinutes",
        updated_at as "updatedAt"
      from public.work_organization_policy where organization_key = 'default'
    `);
    const row = rows[0];
    if (!row) return defaultPolicy();
    const domains = Array.isArray(row.approvedDomains)
      ? row.approvedDomains
      : Array.isArray(row.approved_domains)
        ? row.approved_domains
        : [];
    return {
      ...row,
      appPolicy: normalizeAppPolicy(row.appPolicy ?? row.app_policy),
      approvedDomains: domains.filter(
        (domain): domain is string => typeof domain === "string",
      ),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  } catch {
    return defaultPolicy();
  }
}

export async function saveWorkOrganizationPolicy(
  input: Omit<WorkOrganizationPolicy, "updatedAt">,
  employeeId: string,
) {
  const policy = {
    ...input,
    appPolicy: normalizeAppPolicy(input.appPolicy),
    approvedDomains: normalizeDomains(input.approvedDomains),
  };
  const db = getDb();
  if (!db) {
    demoPolicy = { ...policy, updatedAt: new Date().toISOString() };
    return demoPolicy;
  }
  const domains = JSON.stringify(policy.approvedDomains);
  await db.execute(sql`
    insert into public.work_organization_policy (
      organization_key, approved_domains, default_project_privacy,
      default_team_privacy, guest_invite_policy, external_sharing_enabled,
      app_policy, session_timeout_minutes, updated_by_employee_id
    ) values (
      'default', ${domains}::jsonb, ${policy.defaultProjectPrivacy},
      ${policy.defaultTeamPrivacy}, ${policy.guestInvitePolicy},
      ${policy.externalSharingEnabled}, ${policy.appPolicy},
      ${policy.sessionTimeoutMinutes}, ${employeeId}::uuid
    )
    on conflict (organization_key) do update set
      approved_domains = excluded.approved_domains,
      default_project_privacy = excluded.default_project_privacy,
      default_team_privacy = excluded.default_team_privacy,
      guest_invite_policy = excluded.guest_invite_policy,
      external_sharing_enabled = excluded.external_sharing_enabled,
      app_policy = excluded.app_policy,
      session_timeout_minutes = excluded.session_timeout_minutes,
      updated_by_employee_id = excluded.updated_by_employee_id,
      updated_at = now()
  `);
  return getWorkOrganizationPolicy();
}

export async function isWorkConnectedAppAllowed(toolkit: string) {
  const slug = toolkit.trim().toLowerCase();
  if (isFirstPartyCrmApp(slug)) return true;
  const policy = await getWorkOrganizationPolicy();
  const appPolicy = normalizeAppPolicy(policy.appPolicy);
  if (appPolicy === "disabled") return false;
  return appPolicy === "allow_all" || CURATED_WORK_APPS.has(slug);
}

/**
 * Explicit administrator repair for a disabled Work / Composio policy.
 * Readiness and connection-list queries must never call this mutation helper.
 */
export async function healDisabledConnectedAppPolicy(
  employeeId?: string | null,
): Promise<{ healed: boolean; policy: WorkOrganizationPolicy }> {
  const current = await getWorkOrganizationPolicy();
  if (normalizeAppPolicy(current.appPolicy) !== "disabled") {
    return { healed: false, policy: current };
  }
  const actor =
    employeeId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      employeeId,
    )
      ? employeeId
      : null;
  const db = getDb();
  if (!db) {
    const nextPolicy: WorkOrganizationPolicy = {
      ...current,
      appPolicy: "approved_only",
      updatedAt: new Date().toISOString(),
    };
    getDemoStore().appendAudit({
      actorEmployeeId: actor ?? SYSTEM_EMPLOYEE_ID,
      action: "connections.reopenApprovedAppPolicy",
      entityType: "work_organization_policy",
      entityId: SYSTEM_EMPLOYEE_ID,
      before: { appPolicy: "disabled" },
      after: { appPolicy: "approved_only" },
      reason: "Explicit administrator action",
    });
    demoPolicy = nextPolicy;
    return { healed: true, policy: demoPolicy };
  }
  const healed = await db.transaction(async (tx) => {
    const updated = await tx.execute<{ updatedAt: Date | string }>(sql`
      update public.work_organization_policy
      set app_policy = 'approved_only',
          updated_by_employee_id = coalesce(${actor}::uuid, updated_by_employee_id),
          updated_at = now()
      where organization_key = 'default' and app_policy = 'disabled'
      returning updated_at as "updatedAt"
    `);
    if (!updated[0]) return false;
    await tx.execute(sql`
      insert into public.audit_event (
        actor_employee_id, action, entity_type, before, after, reason
      ) values (
        ${actor}::uuid,
        'connections.reopenApprovedAppPolicy',
        'work_organization_policy',
        jsonb_build_object('appPolicy', 'disabled'),
        jsonb_build_object('appPolicy', 'approved_only'),
        'Explicit administrator action'
      )
    `);
    return true;
  });
  return { healed, policy: await getWorkOrganizationPolicy() };
}

export async function isWorkViewOnlyMember(employeeId: string | null) {
  if (!employeeId) return false;
  const db = getDb();
  if (!db) return demoLicenses.get(employeeId) === "view_only";
  const rows = await db.execute<{ viewOnly: boolean }>(sql`
    select exists (
      select 1 from public.work_member_license
      where employee_id = ${employeeId}::uuid and license_type = 'view_only'
    ) as "viewOnly"
  `);
  return rows[0]?.viewOnly ?? false;
}

export function setDemoWorkLicense(
  employeeId: string,
  license: "full" | "view_only",
) {
  demoLicenses.set(employeeId, license);
}

export function getDemoWorkLicense(employeeId: string) {
  return demoLicenses.get(employeeId) ?? "full";
}

export function listDemoGuestShares() {
  return [...demoGuestShares.values()];
}

export function saveDemoGuestShare(share: DemoGuestShare) {
  demoGuestShares.set(`${share.projectId}:${share.portalUserId}`, share);
  return share;
}

export function removeDemoGuestShare(projectId: string, portalUserId: string) {
  demoGuestShares.delete(`${projectId}:${portalUserId}`);
}

export function getDemoGuestShare(projectId: string, portalUserId: string) {
  return demoGuestShares.get(`${projectId}:${portalUserId}`) ?? null;
}

export function clearDemoWorkGovernance() {
  demoPolicy = defaultPolicy();
  demoLicenses.clear();
  demoGuestShares.clear();
}
