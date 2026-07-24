import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { createCaller } from "./trpc/root";
import { clearDemoWorkAdmin, rowsToCsv } from "./trpc/work-admin-router";
import { clearDemoWorkGovernance, normalizeDomains } from "./work-governance";

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
    expect((await admin.workAdmin.teams.list())[0]?.projects).toContainEqual({
      projectId: project.projectId,
      name: project.name,
      accessLevel: "editor",
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
