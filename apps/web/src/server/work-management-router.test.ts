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

    await caller.admin.features.setOverride({
      featureKey: "work.approvals",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.tasks.create({
        projectId: project.projectId,
        title: "Hidden approval",
        description: "",
        itemType: "approval",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.approvals",
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

  it("runs intake, automation, template, bundle, and approval workflows", async () => {
    const caller = partnerCaller();
    const source = await caller.work.projects.create({
      name: "Workflow source",
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const sourceDetail = await caller.work.projects.get({
      projectId: source.projectId,
    });
    await caller.work.sections.create({
      projectId: source.projectId,
      name: "Legal review",
    });
    await caller.work.rules.create({
      projectId: source.projectId,
      name: "Escalate intake",
      triggerType: "task_added",
      branches: [
        {
          mode: "all",
          conditions: [],
          actions: [{ type: "set_priority", value: "urgent" }],
        },
      ],
    });
    const form = await caller.work.forms.create({
      projectId: source.projectId,
      sectionId: sourceDetail.sections[0]!.sectionId,
      name: "Campaign request",
      description: "",
      titleQuestionKey: "title",
      questions: [
        {
          key: "title",
          label: "Title",
          type: "text",
          required: true,
          options: [],
        },
      ],
      confirmationMessage: "Received",
    });
    const submission = await caller.work.forms.submit({
      formId: form.formId,
      answers: { title: "Launch campaign" },
    });
    expect(submission.message).toBe("Received");
    expect(
      (
        await caller.work.projects.get({ projectId: source.projectId })
      ).items.find((item) => item.itemId === submission.itemId)?.priority,
    ).toBe("urgent");

    const taskTemplate = await caller.work.templates.createTask({
      projectId: source.projectId,
      name: "Kickoff",
      blueprint: {
        title: "Run kickoff",
        description: "",
        itemType: "task",
        priority: "high",
        dueInDays: 2,
        subtasks: [{ title: "Prepare agenda", description: "" }],
      },
    });
    await caller.work.templates.instantiateTask({
      templateId: taskTemplate.templateId,
      projectId: source.projectId,
      sectionId: sourceDetail.sections[0]!.sectionId,
    });
    const projectTemplate = await caller.work.templates.captureProject({
      projectId: source.projectId,
      name: "Campaign project",
    });
    const templatedProject = await caller.work.templates.instantiateProject({
      templateId: projectTemplate.templateId,
      name: "New campaign",
      referenceDate: "2026-07-24",
    });
    expect(
      (await caller.work.projects.list()).some(
        (project) => project.projectId === templatedProject.projectId,
      ),
    ).toBe(true);

    await caller.work.customFields.create({
      projectId: source.projectId,
      name: "Market",
      fieldType: "text",
      options: [],
      isRequired: false,
    });
    const bundle = await caller.work.bundles.capture({
      projectId: source.projectId,
      name: "Campaign standards",
      description: "",
      visibility: "organization",
    });
    const target = await caller.work.projects.create({
      name: "Bundle target",
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    await caller.work.bundles.applyToProject({
      bundleId: bundle.bundleId,
      projectId: target.projectId,
    });
    expect(
      await caller.work.customFields.list({ projectId: target.projectId }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Market" })]),
    );
    expect(
      await caller.work.rules.list({ projectId: target.projectId }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Escalate intake" }),
      ]),
    );

    const approval = await caller.work.tasks.create({
      projectId: source.projectId,
      title: "Approve launch",
      description: "",
      itemType: "approval",
    });
    await expect(
      caller.work.tasks.complete({ itemId: approval.itemId, completed: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.work.approvals.decide({
      itemId: approval.itemId,
      decision: "approved",
      note: "Ready",
    });
    expect(
      (await caller.work.approvals.list({ projectId: source.projectId })).find(
        (item) => item.itemId === approval.itemId,
      )?.decision?.decision,
    ).toBe("approved");
  });

  it("connects goals, portfolios, reporting, resources, time, budgets, and Gantt", async () => {
    const caller = partnerCaller();
    const project = await caller.work.projects.create({
      name: "Planning pilot",
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Deliver plan",
      description: "",
      startDate: "2026-07-20",
      dueAt: "2026-07-24T12:00:00.000Z",
      estimatedMinutes: 480,
    });
    const goal = await caller.work.goals.create({
      name: "Ship the planning pilot",
      description: "",
      dueDate: "2026-07-31",
    });
    await caller.work.goals.link({
      goalId: goal.goalId,
      target: { type: "project", id: project.projectId },
      weight: 1,
    });
    expect(
      (await caller.work.goals.list()).find(
        (item) => item.goalId === goal.goalId,
      )?.progress,
    ).toBe(0);
    await caller.work.tasks.complete({ itemId: task.itemId, completed: true });
    expect(
      (await caller.work.goals.list()).find(
        (item) => item.goalId === goal.goalId,
      )?.progress,
    ).toBe(100);

    const portfolio = await caller.work.portfolios.create({
      name: "Strategic delivery",
      description: "",
    });
    await caller.work.portfolios.addProject({
      portfolioId: portfolio.portfolioId,
      projectId: project.projectId,
    });
    expect(
      (await caller.work.portfolios.list()).find(
        (item) => item.portfolioId === portfolio.portfolioId,
      ),
    ).toMatchObject({ progress: 100, health: "complete" });

    await caller.work.statusUpdates.create({
      targetType: "project",
      targetId: project.projectId,
      health: "complete",
      progress: 100,
      title: "Planning shipped",
      body: "Ready for use",
    });
    expect(
      await caller.work.statusUpdates.list({
        targetType: "project",
        targetId: project.projectId,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Planning shipped" }),
      ]),
    );

    const employeeId = resolveDevUser("partner").employeeId;
    await caller.work.workload.upsert({
      projectId: project.projectId,
      employeeId,
      weekStart: "2026-07-20",
      allocatedMinutes: 2_400,
      roleName: null,
    });
    expect(
      await caller.work.workload.list({
        projectId: project.projectId,
        weekStart: "2026-07-20",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ allocatedMinutes: 2_400, utilization: 100 }),
      ]),
    );

    const logged = await caller.work.time.log({
      projectId: project.projectId,
      itemId: task.itemId,
      workDate: "2028-07-24",
      minutes: 120,
      isBillable: false,
      description: "Planning",
    });
    const active = await caller.work.time.startTimer({
      projectId: project.projectId,
      itemId: task.itemId,
      description: "Review",
    });
    await caller.work.time.discardTimer({ timerId: active.timerId });
    expect(
      await caller.work.time.list({ projectId: project.projectId }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ minutes: 120 })]),
    );
    expect(
      (
        await caller.work.reporting.exportProject({
          projectId: project.projectId,
        })
      ).csv,
    ).toContain('"Deliver plan"');

    const budget = await caller.work.budgets.update({
      projectId: project.projectId,
      budgetAmount: 1_000,
      budgetCurrency: "AED",
      hourlyCostRate: 100,
    });
    expect(budget).toMatchObject({ actualCost: 200, variance: 800 });
    const dashboard = await caller.work.reporting.saveDashboard({
      name: "Planning view",
      config: { projectId: project.projectId },
    });
    expect(await caller.work.reporting.dashboards()).toContainEqual(dashboard);
    await caller.work.time.remove({ timeEntryId: logged.timeEntryId });
    expect(
      await caller.work.time.list({ projectId: project.projectId }),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ timeEntryId: logged.timeEntryId }),
      ]),
    );

    await caller.work.gantt.captureBaseline({ projectId: project.projectId });
    expect(
      (await caller.work.gantt.get({ projectId: project.projectId })).items[0]
        ?.baseline,
    ).toBeTruthy();

    await caller.admin.features.setOverride({
      featureKey: "work.goals",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(caller.work.goals.list()).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.goals",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.capacity_planning",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.workload.upsert({
        projectId: project.projectId,
        employeeId,
        weekStart: "2026-07-27",
        allocatedMinutes: 60,
        roleName: null,
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.capacity_planning",
    });
  });
});
