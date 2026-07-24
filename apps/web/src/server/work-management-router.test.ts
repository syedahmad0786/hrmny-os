import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { createCaller } from "./trpc/root";

function partnerCaller() {
  const user = resolveDevUser("partner");
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

describe("work management", () => {
  beforeEach(() => clearDemoFeatureOverrides());

  it("creates a project graph with task, subtask, dependency, and comment", async () => {
    const caller = partnerCaller();
    const project = await caller.work.projects.create({
      name: "Launch plan",
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const initial = await caller.work.projects.get({
      projectId: project.projectId,
    });
    const sectionId = initial.sections[0]!.sectionId;
    const first = await caller.work.tasks.create({
      projectId: project.projectId,
      sectionId,
      title: "Prepare brief",
      description: "",
    });
    const second = await caller.work.tasks.create({
      projectId: project.projectId,
      sectionId,
      title: "Review brief",
      description: "",
      parentItemId: first.itemId,
    });
    await caller.work.dependencies.add({
      itemId: second.itemId,
      dependsOnItemId: first.itemId,
    });
    const comment = await caller.work.comments.create({
      itemId: first.itemId,
      body: "Ready for review",
    });
    await caller.work.tasks.complete({ itemId: first.itemId, completed: true });

    const result = await caller.work.projects.get({
      projectId: project.projectId,
    });
    expect(result.items).toHaveLength(2);
    expect(
      result.items.find((item) => item.itemId === first.itemId)?.completedAt,
    ).toBeTruthy();
    expect(result.dependencies).toContainEqual({
      itemId: second.itemId,
      dependsOnItemId: first.itemId,
    });
    expect(
      await caller.work.comments.list({ itemId: first.itemId }),
    ).toContainEqual(comment);
  });

  it("enforces a Feature Lab switch at the API boundary", async () => {
    const caller = partnerCaller();
    const project = (await caller.work.projects.list())[0]!;
    const item = (
      await caller.work.projects.get({ projectId: project.projectId })
    ).items[0]!;
    await caller.admin.features.setOverride({
      featureKey: "work.comments",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });

    await expect(
      caller.work.comments.list({ itemId: item.itemId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.comments",
    });
  });

  it("keeps task metadata when generating a recurring occurrence", async () => {
    const caller = partnerCaller();
    const project = await caller.work.projects.create({
      name: "Recurring operations",
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const sectionId = (
      await caller.work.projects.get({ projectId: project.projectId })
    ).sections[0]!.sectionId;
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      sectionId,
      title: "Monthly check",
      description: "",
      dueAt: "2026-01-31T12:00:00.000Z",
    });
    const tag = await caller.work.tags.create({
      projectId: project.projectId,
      name: `Operations ${project.projectId}`,
    });
    await caller.work.tags.setForTask({
      itemId: task.itemId,
      tagIds: [tag.tagId],
    });
    const field = await caller.work.customFields.create({
      projectId: project.projectId,
      name: "Region",
      fieldType: "single_select",
      options: ["UAE", "KSA"],
      isRequired: false,
    });
    await caller.work.customFields.setValue({
      itemId: task.itemId,
      customFieldId: field.customFieldId,
      value: "UAE",
    });
    await caller.work.followers.follow({ itemId: task.itemId });
    await caller.work.recurrence.set({
      itemId: task.itemId,
      recurrence: { frequency: "monthly", interval: 1 },
    });

    const completed = await caller.work.tasks.complete({
      itemId: task.itemId,
      completed: true,
    });
    expect(completed.generatedItemId).toBeTruthy();
    const nextId = completed.generatedItemId!;
    expect(await caller.work.tags.forTask({ itemId: nextId })).toContainEqual(
      tag,
    );
    expect(
      await caller.work.customFields.values({ itemId: nextId }),
    ).toContainEqual({
      customFieldId: field.customFieldId,
      value: "UAE",
    });
    expect(await caller.work.followers.list({ itemId: nextId })).toHaveLength(
      1,
    );
  });
});
