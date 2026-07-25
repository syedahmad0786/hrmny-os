import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { clearDemoWorkAiStudio } from "./work-ai-studio";
import { clearDemoWorkAi } from "./work-ai";
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

describe("AI Studio", () => {
  beforeEach(() => {
    clearDemoFeatureOverrides();
    clearDemoWorkAi();
    clearDemoWorkAiStudio();
  });

  it("drafts, publishes, runs, and governs a no-code workflow", async () => {
    const caller = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.ai.studio",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const project = await caller.work.projects.create({
      name: `Studio ${crypto.randomUUID()}`,
      description: "Workflow project",
      privacy: "private",
      color: "#C7702E",
    });
    const generated = await caller.workAiStudio.draft({
      requestText: "Every day create a task that reviews new requests",
    });
    expect(generated.draft.triggerType).toBe("scheduled");

    const workflow = await caller.workAiStudio.create({
      ...generated.draft,
      projectId: project.projectId,
      referenceText: "Requests must include an owner and due date.",
      model: null,
    });
    expect(workflow.status).toBe("draft");
    const published = await caller.workAiStudio.setStatus({
      workflowId: workflow.workflowId,
      status: "published",
    });
    expect(published.status).toBe("published");

    const result = await caller.workAiStudio.run({
      workflowId: workflow.workflowId,
      itemId: null,
    });
    expect(result.run?.status).toBe("proposed");
    expect(result.run?.result?.actions[0]?.type).toBe("create_task");
    await caller.workAi.applyAction({
      runId: result.run!.runId,
      actionIndex: 0,
    });
    const after = await caller.work.projects.get({
      projectId: project.projectId,
    });
    expect(
      after.items.some((item) => item.title.includes("Run AI Studio")),
    ).toBe(true);

    await caller.workAiStudio.update({
      workflowId: workflow.workflowId,
      workflow: {
        ...generated.draft,
        projectId: project.projectId,
        aiCondition: "Never continue for this test",
        referenceText: "",
        model: null,
      },
    });
    const skipped = await caller.workAiStudio.run({
      workflowId: workflow.workflowId,
      itemId: null,
    });
    expect(skipped.run?.result?.conditionMatched).toBe(false);
    expect(skipped.run?.result?.actions).toEqual([]);
  });

  it("governs custom task status triggers and actions", async () => {
    const caller = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.ai.studio",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const project = await caller.work.projects.create({
      name: `Studio custom status ${crypto.randomUUID()}`,
      description: "Workflow project",
      privacy: "private",
      color: "#C7702E",
    });
    const type = await caller.work.customTaskTypes.create({
      projectId: project.projectId,
      name: "Request",
      icon: "◆",
      isDefault: false,
      statuses: [
        {
          name: "Open",
          color: "#6B7280",
          completionState: "incomplete",
        },
        {
          name: "Closed",
          color: "#2E7D5B",
          completionState: "complete",
        },
      ],
    });
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Route this request",
      description: "",
    });
    const workflow = await caller.workAiStudio.create({
      projectId: project.projectId,
      name: "Set custom status",
      description: "",
      triggerType: "custom_status_changed",
      aiCondition: null,
      instructions: "Set the custom task status using the supplied IDs.",
      referenceText: "",
      allowedActionTypes: ["set_custom_task_status"],
      model: null,
      scheduleMinutes: null,
    });
    const result = await caller.workAiStudio.run({
      workflowId: workflow.workflowId,
      itemId: task.itemId,
    });
    expect(result.run?.result?.actions[0]).toMatchObject({
      type: "set_custom_task_status",
      customTaskTypeId: type.customTaskTypeId,
      itemId: task.itemId,
    });
    await caller.workAi.applyAction({
      runId: result.run!.runId,
      actionIndex: 0,
    });
    expect(
      await caller.work.customTaskTypes.assignments({
        projectId: project.projectId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        itemId: task.itemId,
        customTaskTypeId: type.customTaskTypeId,
        statusName: "Open",
      }),
    );
    await caller.admin.features.setOverride({
      featureKey: "work.custom_task_types",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    expect(await caller.workAiStudio.list()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workflowId: workflow.workflowId }),
      ]),
    );
    await expect(
      caller.workAiStudio.run({
        workflowId: workflow.workflowId,
        itemId: task.itemId,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.custom_task_types",
    });
  });

  it("treats a client AI Studio switch as a project hard boundary", async () => {
    const caller = partnerCaller();
    const clientId = resolveDevUser("portal_a").clientId!;
    await caller.admin.features.setOverride({
      featureKey: "work.ai.studio",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const project = await caller.work.projects.create({
      name: `Client Studio ${crypto.randomUUID()}`,
      description: "",
      privacy: "private",
      clientId,
      color: "#C7702E",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.ai.studio",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client AI disabled",
    });
    expect(
      await caller.work.projects.get({ projectId: project.projectId }),
    ).toMatchObject({
      enabledFeatureKeys: expect.not.arrayContaining(["work.ai.studio"]),
    });
    await expect(
      caller.workAiStudio.create({
        projectId: project.projectId,
        name: "Blocked workflow",
        description: "",
        triggerType: "manual",
        aiCondition: null,
        instructions: "Do the work",
        referenceText: "",
        allowedActionTypes: ["create_task"],
        model: null,
        scheduleMinutes: null,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.ai.studio",
    });
  });

  it("fails closed when AI Studio is disabled", async () => {
    const caller = partnerCaller();
    await expect(caller.workAiStudio.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.ai.studio",
    });
  });
});
