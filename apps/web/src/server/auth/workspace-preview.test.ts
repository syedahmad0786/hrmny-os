import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaller } from "../trpc/root";
import { getDemoStore } from "../demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./session";
import { defaultWorkbookConfig } from "@/lib/crm-workbook";

function caller(role: string, target?: string) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    requestedPreviewEmployeeId: target,
  });
}

describe("admin workspace preview", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "dev");
    vi.stubEnv("ALLOW_DEV_AUTH", "true");
    vi.stubEnv("DATABASE_MODE", "memory");
    vi.stubEnv("DATABASE_URL", "");
  });

  it("shows the target's real owned work and records the real admin", async () => {
    const target = resolveDevUser("am");
    const ownTask = await caller("am").work.personal.quickAdd({
      title: "AM preview ownership proof",
      description: "Synthetic",
    });
    const preview = caller("partner", target.employeeId);
    const session = await preview.auth.session();
    expect(session.employeeId).toBe(target.employeeId);
    expect(session.roles).toEqual(target.roles);
    expect(session.canViewMargin).toBe(false);
    expect(session.workspacePreview?.viewerName).toBe("Dev Partner");
    expect(session.canPreviewWorkspace).toBe(true);
    const tasks = await preview.work.personal.myTasks();
    expect(tasks.some((task) => task.itemId === ownTask.itemId)).toBe(true);
    expect(
      (await caller("partner").work.personal.myTasks()).some(
        (task) => task.itemId === ownTask.itemId,
      ),
    ).toBe(false);
    expect(
      getDemoStore().audits.some(
        (event) =>
          event.action === "workspace.preview.read" &&
          event.entityId === target.employeeId &&
          event.actorEmployeeId === resolveDevUser("partner").employeeId,
      ),
    ).toBe(true);
  });

  it("rejects forged staff access, unavailable employees and portal targets", async () => {
    await expect(caller("am").auth.workspaceUsers()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller("am", resolveDevUser("partner").employeeId).auth.session(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("portal_a", resolveDevUser("partner").employeeId).auth.session(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("partner", "not-an-id").auth.session(),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("partner", "10000000-0000-4000-8000-000000000099").auth.session(),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller("partner", resolveDevUser("portal_a").employeeId).auth.session(),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await caller("director").auth.workspaceUsers()).length,
    ).toBeGreaterThan(0);
  });

  it("blocks writes and private APIs before their resolvers run", async () => {
    const preview = caller("partner", resolveDevUser("am").employeeId);
    expect((await preview.crm.workbook.snapshot()).rows).toBeDefined();
    await expect(
      preview.crm.workbook.export({
        config: defaultWorkbookConfig("contacts"),
        allTabs: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      preview.crm.workbook.saveView({
        name: "Unauthorized change",
        config: defaultWorkbookConfig("contacts"),
        visibility: "personal",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      preview.work.personal.quickAdd({ title: "Must not exist" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(preview.auth.logout()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(preview.connections.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      preview.leadgen.outreach.conversations(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(preview.chat.listThreads()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(preview.work.personal.inbox()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      (await caller("am").work.personal.myTasks()).some(
        (task) => task.title === "Must not exist",
      ),
    ).toBe(false);
  });
});
