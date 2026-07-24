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

  it("fails closed when AI Studio is disabled", async () => {
    const caller = partnerCaller();
    await expect(caller.workAiStudio.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.ai.studio",
    });
  });
});
