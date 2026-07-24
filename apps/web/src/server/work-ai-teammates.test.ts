import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { createCaller } from "./trpc/root";
import { getDemoWork } from "./trpc/work-management-router";
import {
  clearDemoAssignedTeammateEvents,
  listDemoAssignedTeammateEvents,
} from "./work-ai-teammate-events";
import {
  clearDemoWorkAiTeammates,
  runWorkAiTeammateJob,
} from "./work-ai-teammates";
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
    "work.ai.connectors",
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
    clearDemoAssignedTeammateEvents();
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
      allowedConnectedApps: [],
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

    await caller.workAiTeammates.update({
      teammateId: teammate.teammateId,
      teammate: {
        name: teammate.name,
        roleDescription: teammate.roleDescription,
        instructions: teammate.instructions,
        allowedActionTypes: ["create_subtask", "schedule_follow_up"],
        allowedConnectedApps: [],
        model: null,
      },
    });
    const subtaskRun = await caller.workAiTeammates.run({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      itemId: task.itemId,
      requestText: "Create a subtask to review the client update",
    });
    await caller.workAi.applyAction({
      runId: subtaskRun.run!.runId,
      actionIndex: 0,
    });
    expect(
      (
        await caller.work.projects.get({ projectId: project.projectId })
      ).items.some((item) => item.parentItemId === task.itemId),
    ).toBe(true);

    const runAt = new Date(Date.now() + 86_400_000).toISOString();
    const followUpRun = await caller.workAiTeammates.run({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      itemId: task.itemId,
      requestText: `Follow up at ${runAt}`,
    });
    const scheduled = await caller.workAi.applyAction({
      runId: followUpRun.run!.runId,
      actionIndex: 0,
    });
    expect(scheduled.result).toMatchObject({ runAt });

    await caller.workAiTeammates.update({
      teammateId: teammate.teammateId,
      teammate: {
        name: teammate.name,
        roleDescription: teammate.roleDescription,
        instructions: teammate.instructions,
        allowedActionTypes: ["create_external_file"],
        allowedConnectedApps: [],
        model: null,
      },
    });
    const blockedFileRun = await caller.workAiTeammates.run({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      itemId: task.itemId,
      requestText: "Create a Google document for the client plan",
    });
    expect(blockedFileRun.run?.status).toBe("answered");

    await caller.workAiTeammates.update({
      teammateId: teammate.teammateId,
      teammate: {
        name: teammate.name,
        roleDescription: teammate.roleDescription,
        instructions: teammate.instructions,
        allowedActionTypes: ["create_external_file"],
        allowedConnectedApps: ["google_workspace"],
        model: null,
      },
    });
    const grantedFileRun = await caller.workAiTeammates.run({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      itemId: task.itemId,
      requestText: "Create a Google document for the client plan",
    });
    expect(grantedFileRun.run?.result?.actions[0]?.type).toBe(
      "create_external_file",
    );

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

  it("triggers assigned teammates from forms and recurrence within the project client boundary", async () => {
    const caller = partnerCaller();
    await enableTeammates(caller);
    const project = await caller.work.projects.create({
      name: `Automated teammate ${crypto.randomUUID()}`,
      description: "Form and recurring work",
      privacy: "private",
      color: "#C7702E",
    });
    const teammate = await caller.workAiTeammates.create({
      name: "Intake partner",
      roleDescription: "Triage recurring requests",
      instructions: "Review the task and propose the next useful action.",
      allowedActionTypes: ["create_comment"],
      allowedConnectedApps: [],
      model: null,
    });
    await caller.workAiTeammates.projects.set({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      accessLevel: "editor",
    });
    const form = await caller.work.forms.create({
      projectId: project.projectId,
      name: `AI intake ${crypto.randomUUID()}`,
      description: "",
      titleQuestionKey: "title",
      questions: [
        {
          key: "title",
          label: "Request title",
          type: "text",
          required: true,
          options: [],
        },
      ],
      defaultAssigneeEmployeeId: teammate.employeeId,
      confirmationMessage: "Received",
      accessLevel: "organization",
    });
    const submission = await caller.work.forms.submit({
      formId: form.formId,
      answers: { title: "Review new request" },
    });
    expect(listDemoAssignedTeammateEvents()).toContainEqual(
      expect.objectContaining({
        itemId: submission.itemId,
        assigneeEmployeeId: teammate.employeeId,
        requestText: expect.stringContaining("form submission"),
      }),
    );

    const recurring = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Weekly intake review",
      description: "",
      assigneeEmployeeId: teammate.employeeId,
      dueAt: "2026-07-24T12:00:00.000Z",
    });
    await caller.work.recurrence.set({
      itemId: recurring.itemId,
      recurrence: { frequency: "weekly", interval: 1 },
    });
    clearDemoAssignedTeammateEvents();
    const completed = await caller.work.tasks.complete({
      itemId: recurring.itemId,
      completed: true,
    });
    expect(completed.generatedItemId).toBeTruthy();
    expect(listDemoAssignedTeammateEvents()).toContainEqual(
      expect.objectContaining({
        itemId: completed.generatedItemId,
        assigneeEmployeeId: teammate.employeeId,
        requestText: expect.stringContaining("recurring task"),
      }),
    );

    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(project.projectId)!.clientId = clientId;
    const visibleRun = await caller.workAiTeammates.run({
      teammateId: teammate.teammateId,
      projectId: project.projectId,
      itemId: submission.itemId,
      requestText: "Review the assigned request",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.ai.teammates",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client disabled automated teammates",
    });
    await expect(
      caller.workAiTeammates.run({
        teammateId: teammate.teammateId,
        projectId: project.projectId,
        itemId: submission.itemId,
        requestText: "Continue the request",
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.ai.teammates",
    });
    expect(
      await caller.workAiTeammates.activity.list({
        teammateId: teammate.teammateId,
      }),
    ).not.toContainEqual(
      expect.objectContaining({ teammateRunId: visibleRun.teammateRunId }),
    );
    await expect(
      caller.work.tasks.update({
        itemId: submission.itemId,
        assigneeEmployeeId: teammate.employeeId,
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.ai.teammates",
    });
    await expect(
      runWorkAiTeammateJob({
        teammateId: teammate.teammateId,
        itemId: submission.itemId,
        actorEmployeeId: resolveDevUser("partner").employeeId,
        requestText: "Queued before the client disabled AI teammates",
        triggerType: "assignment",
        eventKey: `disabled:${crypto.randomUUID()}`,
      }),
    ).resolves.toEqual({ disabled: true });
  });
});
