import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides, setFeatureOverride } from "./features";
import { createCaller } from "./trpc/root";
import {
  getVerifiedWorkAppConnection,
  WORK_APP_CATALOG,
  workIntegrationFeatureKeysForToolkit,
} from "./trpc/connections-router";
import { clearDemoWorkAdmin, rowsToCsv } from "./trpc/work-admin-router";
import {
  clearDemoWorkGovernance,
  getWorkOrganizationPolicy,
  healDisabledConnectedAppPolicy,
  isFirstPartyCrmApp,
  isWorkConnectedAppAllowed,
  normalizeAppPolicy,
  normalizeDomains,
} from "./work-governance";

function caller(persona: string) {
  const user = resolveDevUser(persona);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

describe("Work governance", () => {
  beforeEach(() => {
    clearDemoFeatureOverrides();
    clearDemoWorkGovernance();
    clearDemoWorkAdmin();
  });

  it("normalizes domains and emits spreadsheet-safe CSV", () => {
    expect(
      normalizeDomains([" HRMNY.com ", "hrmny.com", "client.ae", "-"]),
    ).toEqual(["client.ae", "hrmny.com"]);
    expect(rowsToCsv([{ name: "A, B", note: 'He said "yes"' }])).toBe(
      'name,note\r\n"A, B","He said ""yes"""',
    );
  });

  it("allows curated apps under the default approved-only policy", async () => {
    expect(normalizeAppPolicy("nope")).toBe("approved_only");
    expect(isFirstPartyCrmApp("google_workspace")).toBe(true);
    expect(await isWorkConnectedAppAllowed("asana")).toBe(true);
    expect(await isWorkConnectedAppAllowed("slack")).toBe(true);
    expect(await isWorkConnectedAppAllowed("unreviewed_app")).toBe(false);
    await expect(
      caller("partner").connections.authorizeManaged({
        toolkit: "unreviewed_app",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller("partner").workAdmin.policy.save({
      approvedDomains: [],
      defaultProjectPrivacy: "organization",
      defaultTeamPrivacy: "request",
      guestInvitePolicy: "admins",
      externalSharingEnabled: true,
      appPolicy: "disabled",
      sessionTimeoutMinutes: 720,
    });
    expect(await isWorkConnectedAppAllowed("slack")).toBe(false);
    expect(await isWorkConnectedAppAllowed("composio")).toBe(false);
    expect(await isWorkConnectedAppAllowed("unreviewed_app")).toBe(false);
    for (const toolkit of [
      "google_workspace",
      "apollo",
      "hunter",
      "n8n",
      "xero",
      "canva",
      "linkedin",
      "asana",
    ]) {
      expect(await isWorkConnectedAppAllowed(toolkit)).toBe(true);
    }
    expect((await getWorkOrganizationPolicy()).appPolicy).toBe("disabled");
    const rows = await caller("partner").connections.list();
    expect(rows.find((row) => row.toolkit === "google_workspace")?.allowed).toBe(
      true,
    );
    expect(rows.find((row) => row.toolkit === "apollo")?.allowed).toBe(true);
    expect(rows.find((row) => row.toolkit === "hunter")?.allowed).toBe(true);
    expect((await getWorkOrganizationPolicy()).appPolicy).toBe("approved_only");
    expect(await isWorkConnectedAppAllowed("slack")).toBe(true);
    expect(await isWorkConnectedAppAllowed("composio")).toBe(true);
    const policy = await caller("partner").connections.organizationPolicy();
    expect(policy).toMatchObject({
      appPolicy: "approved_only",
      healed: false,
      firstPartyAlwaysAllowed: true,
    });
    expect((await healDisabledConnectedAppPolicy()).healed).toBe(false);
  });

  it("governs every Work app family before Composio is called", async () => {
    expect(new Set(WORK_APP_CATALOG.map((item) => item.family))).toEqual(
      new Set(["files", "communication", "enterprise"]),
    );
    expect(workIntegrationFeatureKeysForToolkit("slack")).toEqual([
      "work.integrations.communication",
      "work.integrations.communication.slack",
    ]);
    const partner = resolveDevUser("partner");
    await setFeatureOverride({
      featureKey: "work.integrations.communication.slack",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      updatedByEmployeeId: partner.employeeId,
    });
    await expect(
      caller("partner").connections.startWorkAppLink({ toolkit: "slack" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.integrations.communication.slack",
    });
    clearDemoFeatureOverrides();

    for (const featureKey of [
      "work.integrations.files",
      "work.integrations.communication",
      "work.integrations.enterprise",
    ]) {
      await setFeatureOverride({
        featureKey,
        scopeType: "global",
        scopeKey: "global",
        enabled: false,
        updatedByEmployeeId: partner.employeeId,
      });
    }

    await expect(caller("partner").connections.workApps()).resolves.toEqual({
      bridgeAllowed: true,
      bridgeConfigured: false,
      bridgeError: null,
      apps: [],
    });
    await expect(
      caller("partner").connections.startWorkAppLink({ toolkit: "slack" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.integrations.communication",
    });
  });

  it("accepts only the current employee's matching Composio account", async () => {
    const employee = resolveDevUser("partner");
    const previousKey = process.env.COMPOSIO_API_KEY;
    process.env.COMPOSIO_API_KEY = "test-key";
    let items = [
      {
        id: "ca_other_user",
        status: "ACTIVE",
        toolkit: { slug: "slack" },
        user_id: "other-employee",
      },
      {
        id: "ca_wrong_toolkit",
        status: "ACTIVE",
        toolkit: { slug: "outlook" },
        user_id: employee.employeeId,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items, next_cursor: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    try {
      await expect(
        getVerifiedWorkAppConnection(employee.employeeId, "slack", {
          clientId: null,
          roles: employee.roles,
        }),
      ).resolves.toBeNull();
      items = [
        ...items,
        {
          id: "ca_employee_slack",
          status: "ACTIVE",
          toolkit: { slug: "slack" },
          user_id: employee.employeeId,
        },
      ];
      await expect(
        getVerifiedWorkAppConnection(employee.employeeId, "slack", {
          clientId: null,
          roles: employee.roles,
        }),
      ).resolves.toMatchObject({
        account: { id: "ca_employee_slack" },
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.COMPOSIO_API_KEY;
      else process.env.COMPOSIO_API_KEY = previousKey;
    }
  });

  it("manages teams and denies every Work mutation for a view-only member", async () => {
    const admin = caller("partner");
    const project = (await admin.work.projects.list())[0]!;
    const team = await admin.workAdmin.teams.create({
      name: "Operations",
      description: "",
      privacy: "private",
    });
    await admin.workAdmin.teams.setProject({
      teamId: team.teamId,
      projectId: project.projectId,
      included: true,
    });
    await admin.workAdmin.teams.setMessagePermission({
      teamId: team.teamId,
      permission: "admins",
    });
    expect((await admin.workAdmin.teams.list())[0]?.projects).toContainEqual({
      projectId: project.projectId,
      name: project.name,
      accessLevel: "editor",
    });
    expect((await admin.workAdmin.teams.list())[0]).toMatchObject({
      messageSendPermission: "admins",
    });

    const am = resolveDevUser("am");
    await admin.workAdmin.members.setLicense({
      employeeId: am.employeeId,
      licenseType: "view_only",
    });
    await expect(caller("am").work.projects.list()).resolves.toBeTruthy();
    await expect(
      caller("am").work.projects.create({
        name: "Must not be created",
        description: "",
        color: "#C7702E",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FORBIDDEN: Work access is view-only",
    });
  });

  it("restricts a guest to an explicitly shared project and allows commenter access", async () => {
    const admin = caller("partner");
    const project = (await admin.work.projects.list())[0]!;
    const portal = resolveDevUser("portal_a");
    await admin.workAdmin.guests.invite({
      projectId: project.projectId,
      clientId: portal.clientId!,
      email: portal.email,
      displayName: portal.displayName,
      accessLevel: "commenter",
    });

    const guest = caller("portal_a");
    const shared = await guest.portal.work.projects.list();
    expect(shared).toHaveLength(1);
    expect(shared[0]?.projectId).toBe(project.projectId);
    const detail = await guest.portal.work.projects.get({
      projectId: project.projectId,
    });
    const itemId = String(detail.items[0]!.itemId);
    const comment = await guest.portal.work.comments.create({
      itemId,
      body: "Guest feedback",
    });
    expect(comment.authorName).toBe(portal.displayName);
    expect(await guest.portal.work.comments.list({ itemId })).toContainEqual(
      comment,
    );
  });
});
