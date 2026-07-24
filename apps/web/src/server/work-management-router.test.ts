import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { createCaller } from "./trpc/root";
import {
  getDemoWork,
  isProofableAttachment,
} from "./trpc/work-management-router";

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

  it("runs governed messages, replies, reactions, and Inbox filters", async () => {
    const caller = partnerCaller();
    const project = await caller.work.projects.create({
      name: `Communications ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const message = await caller.work.messages.create({
      projectId: project.projectId,
      subject: "Weekly update",
      body: "Delivery remains on track.",
      isAnnouncement: true,
    });
    const reply = await caller.work.messages.comment({
      messageId: message.messageId,
      body: "Acknowledged",
    });
    await caller.work.likes.set({
      targetType: "message",
      targetId: message.messageId,
      liked: true,
    });
    await caller.work.likes.set({
      targetType: "message_comment",
      targetId: reply.messageCommentId,
      liked: true,
    });
    expect(
      await caller.work.messages.list({ projectId: project.projectId }),
    ).toContainEqual(
      expect.objectContaining({
        messageId: message.messageId,
        commentCount: 1,
        likeCount: 1,
        likedByMe: true,
      }),
    );
    expect(
      await caller.work.messages.comments({ messageId: message.messageId }),
    ).toContainEqual(
      expect.objectContaining({
        messageCommentId: reply.messageCommentId,
        likeCount: 1,
        likedByMe: true,
      }),
    );
    await expect(
      caller.work.messages.list({ teamId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const notificationId = crypto.randomUUID();
    getDemoWork().notifications.set(notificationId, {
      notificationId,
      recipientEmployeeId: resolveDevUser("partner").employeeId,
      itemId: null,
      projectId: project.projectId,
      messageId: message.messageId,
      eventType: "message",
      message: "New project message",
      readAt: null,
      createdAt: new Date().toISOString(),
    });
    expect(
      await caller.work.personal.inbox({ kinds: ["messages"] }),
    ).toContainEqual(expect.objectContaining({ notificationId }));

    const detail = await caller.work.projects.get({
      projectId: project.projectId,
    });
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      sectionId: detail.sections[0]!.sectionId,
      title: "Discuss launch",
      description: "",
    });
    const taskComment = await caller.work.comments.create({
      itemId: task.itemId,
      body: "Please review",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.comments",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.likes.summary({
        targetType: "comment",
        targetId: taskComment.commentId,
      }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.comments" });

    await caller.admin.features.setOverride({
      featureKey: "work.likes",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.likes.summary({
        targetType: "message",
        targetId: message.messageId,
      }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.likes" });
    await caller.admin.features.setOverride({
      featureKey: "work.inbox.message_status_filters",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.personal.inbox({ kinds: ["messages"] }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.inbox.message_status_filters",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.project_messages",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.messages.list({ projectId: project.projectId }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.project_messages",
    });
    expect(await caller.work.personal.inbox({})).not.toContainEqual(
      expect.objectContaining({ notificationId }),
    );
  });

  it("applies the client Feature Lab scope to project status updates", async () => {
    const caller = partnerCaller();
    const project = await caller.work.projects.create({
      name: `Client status ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(project.projectId)!.clientId = clientId;
    await caller.work.statusUpdates.create({
      targetType: "project",
      targetId: project.projectId,
      health: "on_track",
      progress: 20,
      title: "Started",
      body: "",
    });
    const notificationId = crypto.randomUUID();
    getDemoWork().notifications.set(notificationId, {
      notificationId,
      recipientEmployeeId: resolveDevUser("partner").employeeId,
      itemId: null,
      projectId: project.projectId,
      messageId: null,
      eventType: "status_update",
      message: "Client status update",
      readAt: null,
      createdAt: new Date().toISOString(),
    });
    await caller.admin.features.setOverride({
      featureKey: "work.status_updates",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.statusUpdates.list({
        targetType: "project",
        targetId: project.projectId,
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.status_updates",
    });
    expect(await caller.work.personal.inbox({})).not.toContainEqual(
      expect.objectContaining({ notificationId }),
    );
  });

  it("turns proofing pins into governed actionable subtasks", async () => {
    expect(
      isProofableAttachment({ name: "creative.PDF", contentType: null }),
    ).toBe(true);
    expect(
      isProofableAttachment({ name: "notes.txt", contentType: "text/plain" }),
    ).toBe(false);

    const caller = partnerCaller();
    const project = await caller.work.projects.create({
      name: `Proofing ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const parent = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Review campaign art",
      description: "",
    });
    const attachment = await caller.work.attachments.addLink({
      itemId: parent.itemId,
      name: "campaign.png",
      url: "https://example.com/campaign.png",
    });
    const annotation = await caller.work.proofing.create({
      attachmentId: attachment.attachmentId,
      xPosition: 0.25,
      yPosition: 0.75,
      pageNumber: 9,
      feedback: "Increase the logo contrast",
      assigneeEmployeeId: null,
      dueAt: "2026-08-01T12:00:00.000Z",
    });
    expect(annotation).toMatchObject({
      attachmentId: attachment.attachmentId,
      title: "Increase the logo contrast",
      pageNumber: null,
      xPosition: 0.25,
      yPosition: 0.75,
    });
    expect(
      (
        await caller.work.projects.get({ projectId: project.projectId })
      ).items.find((item) => item.itemId === annotation.itemId),
    ).toMatchObject({
      parentItemId: parent.itemId,
      dueAt: "2026-08-01T12:00:00.000Z",
    });
    await caller.work.tasks.complete({
      itemId: annotation.itemId,
      completed: true,
    });
    expect(
      await caller.work.proofing.list({
        attachmentId: attachment.attachmentId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        annotationId: annotation.annotationId,
        completedAt: expect.any(String),
      }),
    );
    const pdf = await caller.work.attachments.addLink({
      itemId: parent.itemId,
      name: "campaign.pdf",
      url: "https://example.com/campaign.pdf",
    });
    expect(
      await caller.work.proofing.create({
        attachmentId: pdf.attachmentId,
        xPosition: 0.4,
        yPosition: 0.6,
        pageNumber: 3,
        feedback: "Align this heading",
      }),
    ).toMatchObject({ pageNumber: 3 });

    const unsupported = await caller.work.attachments.addLink({
      itemId: parent.itemId,
      name: "brief.txt",
      url: "https://example.com/brief.txt",
    });
    await expect(
      caller.work.proofing.create({
        attachmentId: unsupported.attachmentId,
        xPosition: 0.5,
        yPosition: 0.5,
        feedback: "Unsupported",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.admin.features.setOverride({
      featureKey: "work.proofing",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.proofing.list({ attachmentId: attachment.attachmentId }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.proofing" });
    await caller.admin.features.setOverride({
      featureKey: "work.proofing",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.subtasks",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.proofing.list({ attachmentId: attachment.attachmentId }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.subtasks" });
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

  it("runs collaborator rules and validates scheduled rule cadence", async () => {
    const caller = partnerCaller();
    const project = await caller.work.projects.create({
      name: `Rule triggers ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const section = (
      await caller.work.projects.get({ projectId: project.projectId })
    ).sections[0]!;
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      sectionId: section.sectionId,
      title: "Invite reviewer",
      description: "",
    });
    await expect(
      caller.work.rules.create({
        projectId: project.projectId,
        name: "Invalid schedule",
        triggerType: "scheduled",
        scheduleMinutes: null,
        branches: [
          { mode: "all", conditions: [], actions: [{ type: "complete" }] },
        ],
      }),
    ).rejects.toThrow();
    const scheduled = await caller.work.rules.create({
      projectId: project.projectId,
      name: "Daily sweep",
      triggerType: "scheduled",
      scheduleMinutes: 1440,
      branches: [
        {
          mode: "all",
          conditions: [
            { field: "completed", operator: "equals", value: false },
          ],
          actions: [{ type: "set_priority", value: "high" }],
        },
      ],
    });
    expect(scheduled.scheduleMinutes).toBe(1440);
    await caller.admin.features.setOverride({
      featureKey: "work.rules.scheduled",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.rules.create({
        projectId: project.projectId,
        name: "Disabled schedule",
        triggerType: "scheduled",
        scheduleMinutes: 60,
        branches: [
          { mode: "all", conditions: [], actions: [{ type: "complete" }] },
        ],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.rules.scheduled",
    });
    expect(
      await caller.work.rules.list({ projectId: project.projectId }),
    ).not.toContainEqual(expect.objectContaining({ ruleId: scheduled.ruleId }));
    await caller.work.rules.create({
      projectId: project.projectId,
      name: "Escalate when shared",
      triggerType: "collaborator_added",
      branches: [
        {
          mode: "all",
          conditions: [],
          actions: [{ type: "set_priority", value: "urgent" }],
        },
      ],
    });
    await caller.work.followers.follow({ itemId: task.itemId });
    const detail = await caller.work.projects.get({
      projectId: project.projectId,
    });
    expect(
      detail.items.find((item) => item.itemId === task.itemId)?.priority,
    ).toBe("urgent");
    expect(
      await caller.work.rules.runs({ projectId: project.projectId, limit: 20 }),
    ).toContainEqual(
      expect.objectContaining({ triggerType: "collaborator_added" }),
    );
    const disabledTask = await caller.work.tasks.create({
      projectId: project.projectId,
      sectionId: section.sectionId,
      title: "Do not escalate",
      description: "",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.rules.collaborator_trigger",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await caller.work.followers.follow({ itemId: disabledTask.itemId });
    expect(
      (
        await caller.work.projects.get({ projectId: project.projectId })
      ).items.find((item) => item.itemId === disabledTask.itemId)?.priority,
    ).toBeNull();
    expect(
      await caller.work.rules.runs({ projectId: project.projectId, limit: 20 }),
    ).not.toContainEqual(
      expect.objectContaining({ triggerType: "collaborator_added" }),
    );
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
