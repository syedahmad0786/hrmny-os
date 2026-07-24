import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { createCaller } from "./trpc/root";
import { clearDemoWorkAiTeammates } from "./work-ai-teammates";
import { clearDemoWorkAi } from "./work-ai";

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

async function enableTeammates(caller: ReturnType<typeof partnerCaller>) {
  for (const featureKey of [
    "work.ai.teammates",
    "work.ai.teammate_skills",
    "work.ai.teammate_memory",
  ])
    await caller.admin.features.setOverride({
      featureKey,
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
}

describe("AI Teammates", () => {
  beforeEach(() => {
    clearDemoFeatureOverrides();
    clearDemoWorkAiTeammates();
    clearDemoWorkAi();
  });

  it("keeps skills, memory, approvals, authorship, and project access governed", async () => {
    const caller = partnerCaller();
    await enableTeammates(caller);
    const project = await caller.work.projects.create({
      name: `Teammate ${crypto.randomUUID()}`,
      description: "Private teammate project",
      privacy: "private",
      color: "#C7702E",
    });
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Prepare the client update",
      description: "Use the approved tone",
      itemType: "task",
    });
    const teammate = await caller.workAiTeammates.create({
      name: "Mira",
      roleDescription: "Client communications partner",
      instructions: "Draft concise updates and wait for approval.",
      allowedActionTypes: ["create_comment"],
      model: null,
    });
    await caller.workAiTeammates.projects.set({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      accessLevel: "editor",
    });
    const savedSkill = await caller.workAiTeammates.skills.save({
      teammateId: teammate.teammateId,
      skill: {
        name: "Client update",
        guidance: "Lead with the outcome.",
        triggerCondition: "client update",
        referenceText: "Never expose internal margin data.",
        isActive: true,
      },
    });
    expect(
      await caller.workAiTeammates.skills.list({
        teammateId: teammate.teammateId,
      }),
    ).toContainEqual(expect.objectContaining({ skillId: savedSkill.skillId }));

    const result = await caller.workAiTeammates.run({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      itemId: task.itemId,
      requestText: "Draft the client update for approval",
    });
    expect(result.run?.status).toBe("proposed");
    expect(result.run?.result?.actions[0]?.type).toBe("create_comment");
    expect(
      await caller.work.comments.list({ itemId: task.itemId }),
    ).toHaveLength(0);

    await caller.workAi.applyAction({
      runId: result.run!.runId,
      actionIndex: 0,
    });
    expect(
      await caller.work.comments.list({ itemId: task.itemId }),
    ).toContainEqual(
      expect.objectContaining({
        authorEmployeeId: teammate.employeeId,
        authorName: "Mira",
      }),
    );
    expect(
      await caller.workAiTeammates.memory.list({
        teammateId: teammate.teammateId,
      }),
    ).toHaveLength(1);

    await caller.workAiTeammates.projects.remove({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
    });
    expect(
      await caller.workAiTeammates.memory.list({
        teammateId: teammate.teammateId,
      }),
    ).toHaveLength(0);
    await expect(
      caller.workAiTeammates.run({
        teammateId: teammate.teammateId,
        projectId: project.projectId,
        itemId: task.itemId,
        requestText: "Try again",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed when AI Teammates is disabled", async () => {
    await expect(partnerCaller().workAiTeammates.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.ai.teammates",
    });
  });
});
