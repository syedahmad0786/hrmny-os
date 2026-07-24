import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides, setFeatureOverride } from "./features";
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

function amCaller() {
  const user = resolveDevUser("am");
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

function anonymousCaller() {
  return createCaller({
    user: null,
    employeeId: null,
    roles: [],
    canViewMargin: false,
    clientId: null,
  });
}

describe("work management", () => {
  beforeEach(() => clearDemoFeatureOverrides());

  it("organizes My Tasks in private governed sections", async () => {
    const caller = partnerCaller();
    const user = resolveDevUser("partner");
    const project = await caller.work.projects.create({
      name: `My Tasks ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const detail = await caller.work.projects.get({
      projectId: project.projectId,
    });
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      sectionId: detail.sections[0]!.sectionId,
      title: "Private personal workflow",
      description: "",
      assigneeEmployeeId: user.employeeId,
    });
    const first = await caller.work.personal.myTaskSections.create({
      name: `Today ${Date.now()}`,
    });
    const second = await caller.work.personal.myTaskSections.create({
      name: `Later ${Date.now()}`,
    });
    const all = await caller.work.personal.myTaskSections.list();
    await caller.work.personal.myTaskSections.reorder({
      sectionIds: [
        second.sectionId,
        first.sectionId,
        ...all
          .filter(
            (section) =>
              section.sectionId !== first.sectionId &&
              section.sectionId !== second.sectionId,
          )
          .map((section) => section.sectionId),
      ],
    });
    await caller.work.personal.myTaskSections.moveTask({
      itemId: task.itemId,
      sectionId: first.sectionId,
      position: 2,
    });
    expect(
      (await caller.work.personal.myTasks({ includeCompleted: false })).find(
        (item) => item.itemId === task.itemId,
      ),
    ).toMatchObject({
      projectName: project.name,
      personalSectionId: first.sectionId,
      personalPosition: 2,
    });
    await caller.work.tasks.update({
      itemId: task.itemId,
      assigneeEmployeeId: null,
    });
    expect(
      [...getDemoWork().myTasksMemberships.values()].some(
        (membership) => membership.itemId === task.itemId,
      ),
    ).toBe(false);
    await caller.work.tasks.update({
      itemId: task.itemId,
      assigneeEmployeeId: user.employeeId,
    });
    await caller.work.personal.myTaskSections.moveTask({
      itemId: task.itemId,
      sectionId: first.sectionId,
      position: 0,
    });
    await caller.work.personal.myTaskSections.remove({
      sectionId: first.sectionId,
    });
    await caller.work.personal.myTaskSections.remove({
      sectionId: second.sectionId,
    });
    expect(
      (await caller.work.personal.myTasks({ includeCompleted: false })).find(
        (item) => item.itemId === task.itemId,
      )?.personalSectionId,
    ).toBeNull();

    await setFeatureOverride({
      featureKey: "work.my_tasks.sections",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      updatedByEmployeeId: user.employeeId,
    });
    await expect(
      caller.work.personal.myTaskSections.list(),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.my_tasks.sections",
    });
  });

  it("persists and governs the employee's weekly focus", async () => {
    const user = resolveDevUser("partner");
    const caller = partnerCaller();
    const weekStart = "2026-07-20";
    await caller.work.personal.focus.save({
      weekStart,
      focusText: "Ship the migration safely",
    });
    await expect(
      caller.work.personal.focus.get({ weekStart }),
    ).resolves.toMatchObject({
      employeeId: user.employeeId,
      weekStart,
      focusText: "Ship the migration safely",
    });
    await setFeatureOverride({
      featureKey: "work.my_tasks.focus",
      scopeType: "user",
      scopeKey: user.employeeId,
      enabled: false,
      updatedByEmployeeId: user.employeeId,
    });
    await expect(
      caller.work.personal.focus.get({ weekStart }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.my_tasks.focus",
    });
  });

  it("creates governed private tasks directly from My Tasks", async () => {
    const user = resolveDevUser("partner");
    const caller = partnerCaller();
    const section = await caller.work.personal.myTaskSections.create({
      name: `Personal ${Date.now()}`,
    });
    const first = await caller.work.personal.quickAdd({
      title: "Book focused review",
      dueAt: "2026-07-27T12:00:00.000Z",
      priority: "high",
      personalSectionId: section.sectionId,
    });
    const second = await caller.work.personal.quickAdd({
      title: "Capture follow-up notes",
    });
    expect(first).toMatchObject({
      assigneeEmployeeId: user.employeeId,
      projectKind: "personal",
      projectName: "Private task",
      personalSectionId: section.sectionId,
    });
    expect(second.projectId).toBe(first.projectId);
    expect(
      (await caller.work.projects.list()).some(
        (project) => project.projectId === first.projectId,
      ),
    ).toBe(false);
    expect(
      (await caller.work.personal.myTasks({ includeCompleted: false })).find(
        (item) => item.itemId === first.itemId,
      ),
    ).toMatchObject({
      projectKind: "personal",
      projectName: "Private task",
      personalSectionId: section.sectionId,
    });
    await caller.work.tasks.update({
      itemId: first.itemId,
      title: "Book private focused review",
    });

    const other = resolveDevUser("am");
    const otherCaller = createCaller({
      user: other,
      employeeId: other.employeeId,
      roles: other.roles,
      canViewMargin: sessionCanViewMargin(other),
      clientId: other.clientId,
    });
    await expect(
      otherCaller.work.tasks.get({ itemId: first.itemId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await setFeatureOverride({
      featureKey: "work.my_tasks.quick_add",
      scopeType: "user",
      scopeKey: user.employeeId,
      enabled: false,
      updatedByEmployeeId: user.employeeId,
    });
    await expect(
      caller.work.personal.quickAdd({ title: "Should be blocked" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.my_tasks.quick_add",
    });
  });

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

  it("enforces client Feature Lab boundaries across project APIs and discovery", async () => {
    const caller = partnerCaller();
    const clientId = resolveDevUser("portal_a").clientId!;
    const project = await caller.work.projects.create({
      name: `Client feature boundary ${Date.now()}`,
      description: "",
      privacy: "private",
      clientId,
      color: "#C7702E",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.custom_fields",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client does not use custom fields",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.custom_fields",
      scopeType: "user",
      scopeKey: resolveDevUser("partner").employeeId,
      enabled: true,
      reason: "client boundary must still win",
    });
    const detail = await caller.work.projects.get({
      projectId: project.projectId,
    });
    expect(detail.enabledFeatureKeys).not.toContain("work.custom_fields");
    await expect(
      caller.work.customFields.list({ projectId: project.projectId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.custom_fields",
    });

    await caller.admin.features.setOverride({
      featureKey: "work.projects",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client work module disabled",
    });
    expect(
      (await caller.work.projects.list()).some(
        (candidate) => candidate.projectId === project.projectId,
      ),
    ).toBe(false);
    await expect(
      caller.work.projects.get({ projectId: project.projectId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.projects",
    });
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

  it("manages multiple governed out-of-office periods and away labels", async () => {
    const caller = partnerCaller();
    const date = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const active = await caller.work.outOfOffice.create({
      startDate: date(-1),
      endDate: date(1),
      note: "Annual leave",
    });
    const upcoming = await caller.work.outOfOffice.create({
      startDate: date(5),
      endDate: date(6),
      note: "Conference",
    });
    const past = await caller.work.outOfOffice.create({
      startDate: date(-6),
      endDate: date(-5),
      note: "Returned",
    });

    expect(await caller.work.outOfOffice.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outOfOfficeId: active.outOfOfficeId,
          status: "active",
        }),
        expect.objectContaining({
          outOfOfficeId: upcoming.outOfOfficeId,
          status: "upcoming",
        }),
        expect.objectContaining({
          outOfOfficeId: past.outOfOfficeId,
          status: "past",
        }),
      ]),
    );
    expect(
      await caller.work.outOfOffice.update({
        outOfOfficeId: upcoming.outOfOfficeId,
        startDate: date(5),
        endDate: date(7),
        note: "Updated conference",
      }),
    ).toMatchObject({ endDate: date(7), note: "Updated conference" });
    expect((await caller.work.members.listEmployees())[0]).toMatchObject({
      outOfOfficeUntil: active.endDate,
      outOfOfficeNote: "Annual leave",
      displayLabel: expect.stringContaining("Away through"),
    });
    await caller.work.outOfOffice.remove({
      outOfOfficeId: past.outOfOfficeId,
    });
    expect(await caller.work.outOfOffice.list()).not.toContainEqual(
      expect.objectContaining({ outOfOfficeId: past.outOfOfficeId }),
    );
    await expect(
      caller.work.outOfOffice.create({
        startDate: date(2),
        endDate: date(1),
        note: "Invalid",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.admin.features.setOverride({
      featureKey: "work.out_of_office",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(caller.work.outOfOffice.list()).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.out_of_office",
    });
    expect((await caller.work.members.listEmployees())[0]).toMatchObject({
      outOfOfficeUntil: null,
      outOfOfficeNote: null,
      displayLabel: "Dev Partner",
    });
  });

  it("stores governed personal accessibility preferences", async () => {
    const caller = partnerCaller();
    expect(await caller.work.accessibility.get()).toMatchObject({
      theme: "system",
      colorblindMode: false,
      reducedMotion: false,
    });
    expect(
      await caller.work.accessibility.update({
        theme: "dark",
        colorblindMode: true,
        reducedMotion: true,
      }),
    ).toMatchObject({
      theme: "dark",
      colorblindMode: true,
      reducedMotion: true,
    });
    expect(await caller.work.accessibility.get()).toMatchObject({
      theme: "dark",
      colorblindMode: true,
      reducedMotion: true,
    });

    await caller.admin.features.setOverride({
      featureKey: "work.accessibility",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(caller.work.accessibility.get()).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.accessibility",
    });
    await expect(
      caller.work.accessibility.update({
        theme: "light",
        colorblindMode: false,
        reducedMotion: false,
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.accessibility",
    });
  });

  it("turns governed rich-text person mentions into task followers", async () => {
    const caller = partnerCaller();
    const employeeId = resolveDevUser("partner").employeeId;
    const project = await caller.work.projects.create({
      name: `Rich text ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const task = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Mentioned task",
      description: "",
    });
    await caller.work.tasks.update({
      itemId: task.itemId,
      description: `Please review @[Dev Partner](person:${employeeId})`,
    });
    expect(await caller.work.followers.list({ itemId: task.itemId })).toEqual(
      expect.arrayContaining([expect.objectContaining({ employeeId })]),
    );

    const plainTask = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Plain text task",
      description: "",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.rich_text",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await caller.work.comments.create({
      itemId: plainTask.itemId,
      body: `Literal @[Dev Partner](person:${employeeId})`,
    });
    expect(
      await caller.work.followers.list({ itemId: plainTask.itemId }),
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ employeeId })]),
    );
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

  it("governs shared custom task types and completion-aware statuses", async () => {
    const caller = partnerCaller();
    const source = await caller.work.projects.create({
      name: `Custom type source ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const target = await caller.work.projects.create({
      name: `Custom type target ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const type = await caller.work.customTaskTypes.create({
      projectId: source.projectId,
      name: "Request",
      icon: "◆",
      isDefault: true,
      statuses: [
        {
          name: "Backlog",
          color: "#6B7280",
          completionState: "incomplete",
        },
        {
          name: "In progress",
          color: "#C7702E",
          completionState: "incomplete",
        },
        {
          name: "Resolved",
          color: "#2E7D5B",
          completionState: "complete",
        },
      ],
    });
    const task = await caller.work.tasks.create({
      projectId: source.projectId,
      title: "Handle request",
      description: "",
    });
    expect(
      await caller.work.customTaskTypes.assignments({
        projectId: source.projectId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        itemId: task.itemId,
        customTaskTypeId: type.customTaskTypeId,
        statusName: "Backlog",
      }),
    );

    const completeStatus = type.statuses.find(
      (status) => status.completionState === "complete",
    )!;
    await caller.work.customTaskTypes.setForTask({
      projectId: source.projectId,
      itemId: task.itemId,
      customTaskTypeId: type.customTaskTypeId,
      statusOptionId: completeStatus.statusOptionId,
    });
    expect(
      (
        await caller.work.projects.get({ projectId: source.projectId })
      ).items.find((item) => item.itemId === task.itemId)?.completedAt,
    ).toBeTruthy();
    await caller.work.tasks.complete({ itemId: task.itemId, completed: false });
    expect(
      await caller.work.customTaskTypes.assignments({
        projectId: source.projectId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        itemId: task.itemId,
        statusName: "Backlog",
        completionState: "incomplete",
      }),
    );

    await caller.work.customTaskTypes.share({
      sourceProjectId: source.projectId,
      targetProjectId: target.projectId,
      customTaskTypeId: type.customTaskTypeId,
    });
    await expect(
      caller.work.customTaskTypes.list({ projectId: target.projectId }),
    ).resolves.toContainEqual(
      expect.objectContaining({ customTaskTypeId: type.customTaskTypeId }),
    );

    const backlog = type.statuses.find((status) => status.name === "Backlog")!;
    const waitingName = `Waiting ${Date.now()}`;
    await caller.work.customTaskTypes.update({
      projectId: source.projectId,
      customTaskTypeId: type.customTaskTypeId,
      name: "Service request",
      icon: "◇",
      statuses: [
        {
          statusOptionId: backlog.statusOptionId,
          name: "Queued",
          color: "#6B7280",
          completionState: "incomplete",
        },
        {
          name: waitingName,
          color: "#C7702E",
          completionState: "incomplete",
        },
        {
          statusOptionId: completeStatus.statusOptionId,
          name: "Closed",
          color: "#2E7D5B",
          completionState: "complete",
        },
      ],
    });
    const updatedType = (
      await caller.work.customTaskTypes.list({ projectId: source.projectId })
    ).find(
      (candidate) => candidate.customTaskTypeId === type.customTaskTypeId,
    )!;
    expect(updatedType).toMatchObject({ name: "Service request", icon: "◇" });
    expect(updatedType.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Queued", enabled: true }),
        expect.objectContaining({ name: "In progress", enabled: false }),
        expect.objectContaining({ name: "Closed", enabled: true }),
      ]),
    );
    await expect(
      caller.work.customTaskTypes.update({
        projectId: source.projectId,
        customTaskTypeId: type.customTaskTypeId,
        name: "Service request",
        icon: "◇",
        statuses: [
          {
            statusOptionId: backlog.statusOptionId,
            name: "Queued",
            color: "#6B7280",
            completionState: "incomplete",
          },
          {
            name: "In progress",
            color: "#C7702E",
            completionState: "incomplete",
          },
          {
            statusOptionId: completeStatus.statusOptionId,
            name: "Closed",
            color: "#2E7D5B",
            completionState: "complete",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Re-enable the existing status before reusing its name",
    });
    const waitingStatus = updatedType.statuses.find(
      (status) => status.name === waitingName,
    )!;
    await caller.work.rules.create({
      projectId: source.projectId,
      name: `Escalate waiting ${Date.now()}`,
      triggerType: "custom_status_changed",
      scheduleMinutes: null,
      branches: [
        {
          mode: "all",
          conditions: [
            {
              field: "customTaskStatusOptionId",
              operator: "equals",
              value: waitingStatus.statusOptionId,
            },
          ],
          actions: [{ type: "set_priority", value: "urgent" }],
        },
      ],
    });
    await caller.work.customTaskTypes.setForTask({
      projectId: source.projectId,
      itemId: task.itemId,
      customTaskTypeId: type.customTaskTypeId,
      statusOptionId: waitingStatus.statusOptionId,
    });
    expect(
      (
        await caller.work.projects.get({ projectId: source.projectId })
      ).items.find((item) => item.itemId === task.itemId)?.priority,
    ).toBe("urgent");

    await caller.work.rules.create({
      projectId: source.projectId,
      name: `Close new requests ${Date.now()}`,
      triggerType: "task_added",
      scheduleMinutes: null,
      branches: [
        {
          mode: "all",
          conditions: [],
          actions: [
            {
              type: "set_custom_task_status",
              customTaskTypeId: type.customTaskTypeId,
              statusOptionId: completeStatus.statusOptionId,
            },
          ],
        },
      ],
    });
    const closedByRule = await caller.work.tasks.create({
      projectId: source.projectId,
      title: "Rule-managed request",
      description: "",
    });
    expect(
      (
        await caller.work.projects.get({ projectId: source.projectId })
      ).items.find((item) => item.itemId === closedByRule.itemId)?.completedAt,
    ).toBeTruthy();

    await caller.work.customTaskTypes.removeFromProject({
      projectId: source.projectId,
      customTaskTypeId: type.customTaskTypeId,
    });
    expect(
      (
        await caller.work.customTaskTypes.list({
          projectId: source.projectId,
        })
      ).find(
        (candidate) => candidate.customTaskTypeId === type.customTaskTypeId,
      ),
    ).toMatchObject({ isAssociated: false });
    await expect(
      caller.work.customTaskTypes.setForTask({
        projectId: source.projectId,
        itemId: task.itemId,
        customTaskTypeId: type.customTaskTypeId,
        statusOptionId: completeStatus.statusOptionId,
      }),
    ).resolves.toMatchObject({ ok: true });
    const standardTask = await caller.work.tasks.create({
      projectId: source.projectId,
      title: "Standard after removal",
      description: "",
    });
    await expect(
      caller.work.customTaskTypes.setForTask({
        projectId: source.projectId,
        itemId: standardTask.itemId,
        customTaskTypeId: type.customTaskTypeId,
        statusOptionId: completeStatus.statusOptionId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.admin.features.setOverride({
      featureKey: "work.custom_task_types",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    expect(
      await caller.work.rules.list({ projectId: source.projectId }),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ triggerType: "custom_status_changed" }),
      ]),
    );
    await expect(
      caller.work.rules.create({
        projectId: source.projectId,
        name: "Hidden custom status rule",
        triggerType: "custom_status_changed",
        scheduleMinutes: null,
        branches: [
          {
            mode: "all",
            conditions: [],
            actions: [{ type: "set_priority", value: "high" }],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.custom_task_types",
    });
    await expect(
      caller.work.customTaskTypes.list({ projectId: source.projectId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.custom_task_types",
    });
  });

  it("controls each custom task type with default and member access", async () => {
    const owner = partnerCaller();
    const collaborator = amCaller();
    const collaboratorUser = resolveDevUser("am");
    const ownerUser = resolveDevUser("partner");
    const project = await owner.work.projects.create({
      name: `Task type access ${Date.now()}`,
      description: "",
      privacy: "organization",
      color: "#C7702E",
    });
    const type = await owner.work.customTaskTypes.create({
      projectId: project.projectId,
      name: "Incident",
      icon: "◆",
      isDefault: false,
      statuses: [
        {
          name: "Open",
          color: "#6B7280",
          completionState: "incomplete",
        },
        {
          name: "Resolved",
          color: "#2E7D5B",
          completionState: "complete",
        },
      ],
    });
    expect(
      (
        await collaborator.work.customTaskTypes.list({
          projectId: project.projectId,
        })
      ).find(
        (candidate) => candidate.customTaskTypeId === type.customTaskTypeId,
      ),
    ).toMatchObject({ accessLevel: "user" });

    await owner.work.customTaskTypes.setDefaultAccess({
      projectId: project.projectId,
      customTaskTypeId: type.customTaskTypeId,
      accessLevel: "none",
    });
    await expect(
      collaborator.work.customTaskTypes.update({
        projectId: project.projectId,
        customTaskTypeId: type.customTaskTypeId,
        name: "Restricted incident",
        icon: "◆",
        statuses: type.statuses.map((status) => ({
          statusOptionId: status.statusOptionId,
          name: status.name,
          color: status.color,
          completionState: status.completionState,
        })),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      collaborator.work.rules.create({
        projectId: project.projectId,
        name: `Restricted type rule ${Date.now()}`,
        triggerType: "task_added",
        scheduleMinutes: null,
        branches: [
          {
            mode: "all",
            conditions: [
              {
                field: "customTaskTypeId",
                operator: "equals",
                value: type.customTaskTypeId,
              },
            ],
            actions: [{ type: "set_priority", value: "urgent" }],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const task = await owner.work.tasks.create({
      projectId: project.projectId,
      title: "Investigate",
      description: "",
    });
    await expect(
      collaborator.work.customTaskTypes.setForTask({
        projectId: project.projectId,
        itemId: task.itemId,
        customTaskTypeId: type.customTaskTypeId,
        statusOptionId: type.statuses[0]!.statusOptionId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await owner.work.customTaskTypes.setMemberAccess({
      projectId: project.projectId,
      customTaskTypeId: type.customTaskTypeId,
      memberType: "employee",
      memberId: collaboratorUser.employeeId,
      accessLevel: "editor",
    });
    await collaborator.work.customTaskTypes.update({
      projectId: project.projectId,
      customTaskTypeId: type.customTaskTypeId,
      name: "Managed incident",
      icon: "◇",
      statuses: type.statuses.map((status) => ({
        statusOptionId: status.statusOptionId,
        name: status.name,
        color: status.color,
        completionState: status.completionState,
      })),
    });
    await expect(
      collaborator.work.customTaskTypes.access({
        projectId: project.projectId,
        customTaskTypeId: type.customTaskTypeId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.work.customTaskTypes.setMemberAccess({
        projectId: project.projectId,
        customTaskTypeId: type.customTaskTypeId,
        memberType: "employee",
        memberId: ownerUser.employeeId,
        accessLevel: null,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A custom task type must keep at least one admin",
    });
    await owner.work.customTaskTypes.setMemberAccess({
      projectId: project.projectId,
      customTaskTypeId: type.customTaskTypeId,
      memberType: "employee",
      memberId: collaboratorUser.employeeId,
      accessLevel: "admin",
    });
    await owner.work.customTaskTypes.setMemberAccess({
      projectId: project.projectId,
      customTaskTypeId: type.customTaskTypeId,
      memberType: "employee",
      memberId: ownerUser.employeeId,
      accessLevel: null,
    });
    await expect(
      collaborator.work.customTaskTypes.access({
        projectId: project.projectId,
        customTaskTypeId: type.customTaskTypeId,
      }),
    ).resolves.toMatchObject({ defaultAccessLevel: "none" });
  });

  it("carries custom task types and status rules in bundles", async () => {
    const caller = partnerCaller();
    const source = await caller.work.projects.create({
      name: `Bundle type source ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const target = await caller.work.projects.create({
      name: `Bundle type target ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const type = await caller.work.customTaskTypes.create({
      projectId: source.projectId,
      name: "Request",
      icon: "◆",
      isDefault: false,
      statuses: [
        {
          name: "Backlog",
          color: "#6B7280",
          completionState: "incomplete",
        },
        {
          name: "In progress",
          color: "#C7702E",
          completionState: "incomplete",
        },
        {
          name: "Done",
          color: "#2E7D5B",
          completionState: "complete",
        },
      ],
    });
    const active = type.statuses.find(
      (status) => status.name === "In progress",
    )!;
    await caller.work.rules.create({
      projectId: source.projectId,
      name: `Escalate active request ${Date.now()}`,
      triggerType: "custom_status_changed",
      scheduleMinutes: null,
      branches: [
        {
          mode: "all",
          conditions: [
            {
              field: "customTaskStatusOptionId",
              operator: "equals",
              value: active.statusOptionId,
            },
          ],
          actions: [{ type: "set_priority", value: "urgent" }],
        },
      ],
    });
    const bundle = await caller.work.bundles.capture({
      projectId: source.projectId,
      name: `Request bundle ${Date.now()}`,
      description: "",
      visibility: "organization",
    });
    expect(bundle.blueprint.customTaskTypes).toContainEqual(
      expect.objectContaining({ customTaskTypeId: type.customTaskTypeId }),
    );
    await caller.work.bundles.applyToProject({
      bundleId: bundle.bundleId,
      projectId: target.projectId,
    });
    expect(
      await caller.work.customTaskTypes.list({ projectId: target.projectId }),
    ).toContainEqual(
      expect.objectContaining({
        customTaskTypeId: type.customTaskTypeId,
        isAssociated: true,
      }),
    );
    const task = await caller.work.tasks.create({
      projectId: target.projectId,
      title: "Bundled request",
      description: "",
    });
    await caller.work.customTaskTypes.setForTask({
      projectId: target.projectId,
      itemId: task.itemId,
      customTaskTypeId: type.customTaskTypeId,
      statusOptionId: active.statusOptionId,
    });
    expect(
      (
        await caller.work.projects.get({ projectId: target.projectId })
      ).items.find((item) => item.itemId === task.itemId)?.priority,
    ).toBe("urgent");
    const disabledTarget = await caller.work.projects.create({
      name: `Disabled bundle target ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    await caller.admin.features.setOverride({
      featureKey: "work.custom_task_types",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.work.bundles.applyToProject({
        bundleId: bundle.bundleId,
        projectId: disabledTarget.projectId,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.custom_task_types",
    });
  });

  it("rolls bundle publications to installed projects and reports Feature Lab drift", async () => {
    const owner = partnerCaller();
    const installer = amCaller();
    const clientId = "c1000000-0000-4000-8000-0000000000a4";
    const source = await owner.work.projects.create({
      name: `Bundle rollout source ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const target = await installer.work.projects.create({
      name: `Bundle rollout target ${Date.now()}`,
      description: "",
      privacy: "private",
      clientId,
      color: "#C7702E",
    });
    const bundle = await owner.work.bundles.capture({
      projectId: source.projectId,
      name: `Rollout bundle ${Date.now()}`,
      description: "",
      visibility: "organization",
    });
    await installer.work.bundles.applyToProject({
      bundleId: bundle.bundleId,
      projectId: target.projectId,
    });
    await owner.work.customFields.create({
      projectId: source.projectId,
      name: "Region",
      fieldType: "text",
      options: [],
      isRequired: false,
    });
    const published = await owner.work.bundles.publish({
      bundleId: bundle.bundleId,
      sourceProjectId: source.projectId,
    });
    expect(published.rollout).toEqual({
      installedProjectCount: 1,
      updatedProjectCount: 1,
      failures: [],
    });
    expect(
      await installer.work.customFields.list({ projectId: target.projectId }),
    ).toContainEqual(expect.objectContaining({ name: "Region" }));
    expect(
      (await owner.work.bundles.list()).find(
        (candidate) => candidate.bundleId === bundle.bundleId,
      ),
    ).toMatchObject({ installedProjectCount: 1, currentProjectCount: 1 });

    await owner.admin.features.setOverride({
      featureKey: "work.custom_fields",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "test bundle rollout drift",
    });
    await owner.work.customFields.create({
      projectId: source.projectId,
      name: "Budget code",
      fieldType: "text",
      options: [],
      isRequired: false,
    });
    const blocked = await owner.work.bundles.publish({
      bundleId: bundle.bundleId,
      sourceProjectId: source.projectId,
    });
    expect(blocked.rollout).toMatchObject({
      installedProjectCount: 1,
      updatedProjectCount: 0,
      failures: [
        expect.objectContaining({
          projectId: target.projectId,
          message: "FEATURE_DISABLED:work.custom_fields",
        }),
      ],
    });
    await expect(
      installer.work.customFields.list({ projectId: target.projectId }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.custom_fields",
    });
    expect(
      [...getDemoWork().customFields.values()].filter(
        (field) => field.projectId === target.projectId,
      ),
    ).not.toContainEqual(expect.objectContaining({ name: "Budget code" }));
    expect(
      (await owner.work.bundles.list()).find(
        (candidate) => candidate.bundleId === bundle.bundleId,
      ),
    ).toMatchObject({ installedProjectCount: 1, currentProjectCount: 0 });
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

  it("maps project template role placeholders and obeys Feature Lab", async () => {
    const caller = partnerCaller();
    const employeeId = resolveDevUser("partner").employeeId;
    const source = await caller.work.projects.create({
      name: `Role template source ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(source.projectId)!.clientId = clientId;
    const sourceDetail = await caller.work.projects.get({
      projectId: source.projectId,
    });
    await caller.work.tasks.create({
      projectId: source.projectId,
      sectionId: sourceDetail.sections[0]!.sectionId,
      title: "Prepare launch design",
      description: "",
      assigneeEmployeeId: employeeId,
    });
    const captured = await caller.work.templates.captureProject({
      projectId: source.projectId,
      name: `Role template ${Date.now()}`,
      roles: [{ employeeId, name: "Designer" }],
    });
    const listed = await caller.work.templates.list({
      projectId: source.projectId,
    });
    const role = listed
      .find((template) => template.templateId === captured.templateId)
      ?.rolePlaceholders.at(0);
    expect(role).toMatchObject({ name: "Designer" });

    const created = await caller.work.templates.instantiateProject({
      templateId: captured.templateId,
      name: `Role template result ${Date.now()}`,
      referenceDate: "2026-07-24",
      roleAssignments: { [role!.roleId]: employeeId },
    });
    expect(
      (
        await caller.work.projects.get({ projectId: created.projectId })
      ).items.find((item) => item.title === "Prepare launch design"),
    ).toMatchObject({ assigneeEmployeeId: employeeId });

    await caller.admin.features.setOverride({
      featureKey: "work.templates.roles",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "template role pause",
    });
    expect(
      (await caller.work.templates.list({ projectId: source.projectId })).find(
        (template) => template.templateId === captured.templateId,
      )?.rolePlaceholders,
    ).toEqual([]);
    await expect(
      caller.work.templates.instantiateProject({
        templateId: captured.templateId,
        name: "Blocked role assignment",
        referenceDate: "2026-07-24",
        roleAssignments: { [role!.roleId]: employeeId },
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.templates.roles",
    });
    const skipped = await caller.work.templates.instantiateProject({
      templateId: captured.templateId,
      name: "Skipped role assignment",
      referenceDate: "2026-07-24",
      roleAssignments: {},
    });
    expect(
      (
        await caller.work.projects.get({ projectId: skipped.projectId })
      ).items.find((item) => item.title === "Prepare launch design"),
    ).toMatchObject({ assigneeEmployeeId: null });
  });

  it("accepts governed public form submissions with attachments", async () => {
    const owner = partnerCaller();
    const publicUser = anonymousCaller();
    const project = await owner.work.projects.create({
      name: `Public intake ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    await owner.work.rules.create({
      projectId: project.projectId,
      name: `Prioritize public intake ${Date.now()}`,
      triggerType: "task_added",
      scheduleMinutes: null,
      branches: [
        {
          mode: "all",
          conditions: [],
          actions: [{ type: "set_priority", value: "high" }],
        },
      ],
    });
    const form = await owner.work.forms.create({
      projectId: project.projectId,
      name: `Public request ${Date.now()}`,
      description: "Send us the brief.",
      titleQuestionKey: "title",
      questions: [
        {
          key: "title",
          label: "Request title",
          type: "text",
          required: true,
          options: [],
        },
        {
          key: "brief",
          label: "Brief",
          type: "attachment",
          required: true,
          options: [],
          multiple: true,
        },
      ],
      confirmationMessage: "We received your request.",
      accessLevel: "anyone",
    });
    await expect(
      publicUser.work.forms.publicView({ formId: form.formId }),
    ).resolves.toMatchObject({
      name: form.name,
      questions: expect.arrayContaining([
        expect.objectContaining({ type: "attachment" }),
      ]),
    });
    const submission = await publicUser.work.forms.publicSubmit({
      formId: form.formId,
      answers: {
        title: "Launch campaign",
        brief: [
          {
            fileName: "brief.txt",
            contentType: "text/plain",
            contentBase64: Buffer.from("Campaign brief").toString("base64"),
          },
        ],
      },
    });
    expect(submission.message).toBe("We received your request.");
    expect(
      (
        await owner.work.projects.get({ projectId: project.projectId })
      ).items.find((item) => item.itemId === submission.itemId),
    ).toMatchObject({ title: "Launch campaign", priority: "high" });
    expect(
      await owner.work.attachments.list({ itemId: submission.itemId }),
    ).toContainEqual(
      expect.objectContaining({ name: "brief.txt", contentType: "text/plain" }),
    );

    await owner.work.forms.setAccess({
      formId: form.formId,
      accessLevel: "organization",
    });
    await expect(
      publicUser.work.forms.publicView({ formId: form.formId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      publicUser.work.forms.publicSubmit({
        formId: form.formId,
        answers: { title: "Blocked", brief: [] },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rate-limits public forms and obeys their Feature Lab switch", async () => {
    const owner = partnerCaller();
    const publicUser = anonymousCaller();
    const project = await owner.work.projects.create({
      name: `Governed public intake ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const form = await owner.work.forms.create({
      projectId: project.projectId,
      name: `Governed public form ${Date.now()}`,
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
      accessLevel: "anyone",
    });
    for (let index = 0; index < 30; index += 1)
      getDemoWork().formSubmissions.set(crypto.randomUUID(), {
        formId: form.formId,
        itemId: crypto.randomUUID(),
        answers: { title: `Request ${index}` },
        submittedByEmployeeId: null,
        submittedAt: new Date().toISOString(),
      });
    await expect(
      publicUser.work.forms.publicSubmit({
        formId: form.formId,
        answers: { title: "One too many" },
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    await owner.admin.features.setOverride({
      featureKey: "work.forms.public",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "public intake paused",
    });
    await expect(
      publicUser.work.forms.publicView({ formId: form.formId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.forms.public",
    });
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

  it("emits governed external rule events and suppresses them per client", async () => {
    const caller = partnerCaller();
    const clientId = resolveDevUser("portal_a").clientId!;
    const project = await caller.work.projects.create({
      name: `External rule ${Date.now()}`,
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    getDemoWork().projects.get(project.projectId)!.clientId = clientId;
    await caller.admin.features.setOverride({
      featureKey: "work.api_webhooks",
      scopeType: "client",
      scopeKey: clientId,
      enabled: true,
      reason: "external automation test",
    });
    const rule = await caller.work.rules.create({
      projectId: project.projectId,
      name: `Notify automation ${Date.now()}`,
      triggerType: "task_added",
      scheduleMinutes: null,
      branches: [
        {
          mode: "all",
          conditions: [],
          actions: [
            {
              type: "send_webhook",
              message: "A new request needs external handling",
            },
          ],
        },
      ],
    });
    const before = [...getDemoWork().externalRuleEvents.values()].filter(
      (event) => event.projectId === project.projectId,
    ).length;
    await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Prepare partner brief",
      description: "",
    });
    expect(
      [...getDemoWork().externalRuleEvents.values()].find(
        (event) =>
          event.projectId === project.projectId &&
          event.taskTitle === "Prepare partner brief",
      ),
    ).toMatchObject({
      message: "A new request needs external handling",
    });
    expect(
      await caller.work.rules.runs({ projectId: project.projectId, limit: 20 }),
    ).toContainEqual(
      expect.objectContaining({ ruleId: rule.ruleId, status: "succeeded" }),
    );

    await caller.admin.features.setOverride({
      featureKey: "work.rules.external_actions",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "external automation paused",
    });
    expect(
      (await caller.work.rules.list({ projectId: project.projectId })).some(
        (candidate) => candidate.ruleId === rule.ruleId,
      ),
    ).toBe(false);
    expect(
      await caller.work.rules.runs({ projectId: project.projectId, limit: 20 }),
    ).not.toContainEqual(expect.objectContaining({ ruleId: rule.ruleId }));
    await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Suppressed partner brief",
      description: "",
    });
    expect(
      [...getDemoWork().externalRuleEvents.values()].filter(
        (event) => event.projectId === project.projectId,
      ),
    ).toHaveLength(before + 1);
    await expect(
      caller.work.rules.setEnabled({ ruleId: rule.ruleId, enabled: false }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.rules.external_actions",
    });
    await expect(
      caller.work.rules.create({
        projectId: project.projectId,
        name: "Blocked external rule",
        triggerType: "task_added",
        scheduleMinutes: null,
        branches: [
          {
            mode: "all",
            conditions: [],
            actions: [{ type: "send_webhook", message: "Blocked" }],
          },
        ],
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.rules.external_actions",
    });
  });

  it("filters task reports and removes disabled work types", async () => {
    const caller = partnerCaller();
    const employeeId = resolveDevUser("partner").employeeId;
    const project = await caller.work.projects.create({
      name: "Filtered reporting",
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    const parent = await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Parent task",
      description: "",
      priority: "urgent",
      assigneeEmployeeId: employeeId,
    });
    await caller.work.tasks.create({
      projectId: project.projectId,
      parentItemId: parent.itemId,
      title: "Urgent subtask",
      description: "",
      priority: "urgent",
      assigneeEmployeeId: employeeId,
    });
    await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Launch milestone",
      description: "",
      itemType: "milestone",
      priority: "urgent",
      assigneeEmployeeId: employeeId,
    });
    const baseSpec = {
      metric: "task_count" as const,
      completion: "all" as const,
      dueFrom: null,
      dueTo: null,
      includeSubtasks: true,
      customFieldId: null,
      assigneeEmployeeId: employeeId,
      priority: "urgent" as const,
    };
    expect(
      await caller.work.reporting.chart({
        projectId: project.projectId,
        spec: {
          ...baseSpec,
          groupBy: "task_type",
          itemType: "task",
          subtasks: "only",
        },
      }),
    ).toEqual({ data: [{ label: "Task", value: 1 }], total: 1 });
    const dashboard = await caller.work.reporting.saveDashboard({
      name: "Milestone report",
      config: {
        projectId: project.projectId,
        chartStyle: "bar",
        spec: {
          ...baseSpec,
          groupBy: "task_type",
          itemType: "milestone",
          subtasks: "all",
        },
      },
    });
    const timeDashboard = await caller.work.reporting.saveDashboard({
      name: "Estimated work report",
      config: {
        projectId: project.projectId,
        chartStyle: "number",
        spec: {
          ...baseSpec,
          groupBy: "completion",
          metric: "estimated_minutes",
          itemType: "task",
          subtasks: "all",
        },
      },
    });
    const taskDashboard = await caller.work.reporting.saveDashboard({
      name: "Task report",
      config: {
        projectId: project.projectId,
        chartStyle: "bar",
        spec: {
          ...baseSpec,
          groupBy: "completion",
          itemType: "task",
          subtasks: "all",
        },
      },
    });
    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(project.projectId)!.clientId = clientId;
    await caller.admin.features.setOverride({
      featureKey: "work.milestones",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client disabled milestones",
    });
    expect(
      await caller.work.reporting.chart({
        projectId: project.projectId,
        spec: {
          ...baseSpec,
          groupBy: "task_type",
          itemType: null,
          subtasks: "all",
        },
      }),
    ).toEqual({ data: [{ label: "Task", value: 2 }], total: 2 });
    expect(await caller.work.reporting.dashboards()).not.toContainEqual(
      dashboard,
    );
    await caller.admin.features.setOverride({
      featureKey: "work.time_tracking",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client disabled time tracking",
    });
    expect(
      await caller.work.reporting.chart({
        projectId: project.projectId,
        spec: {
          ...baseSpec,
          groupBy: "completion",
          metric: "estimated_minutes",
          itemType: "task",
          subtasks: "all",
        },
      }),
    ).toEqual({ data: [], total: 0 });
    expect(await caller.work.reporting.dashboards()).not.toContainEqual(
      timeDashboard,
    );
    await caller.admin.features.setOverride({
      featureKey: "work.tasks",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client disabled tasks",
    });
    expect(await caller.work.reporting.dashboards()).not.toContainEqual(
      taskDashboard,
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
    const goalUpdate = await caller.work.statusUpdates.create({
      targetType: "goal",
      targetId: goal.goalId,
      health: "complete",
      progress: 100,
      title: "Pilot delivered",
      body: "The contributing project is complete.",
    });
    expect(
      await caller.work.statusUpdates.list({
        targetType: "goal",
        targetId: goal.goalId,
      }),
    ).toContainEqual(goalUpdate);

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
    const secondProject = await caller.work.projects.create({
      name: "Planning support",
      description: "",
      privacy: "private",
      color: "#C7702E",
    });
    await caller.work.portfolios.addProject({
      portfolioId: portfolio.portfolioId,
      projectId: secondProject.projectId,
    });

    await caller.work.statusUpdates.create({
      targetType: "project",
      targetId: project.projectId,
      health: "complete",
      progress: 100,
      title: "Planning shipped",
      body: "Ready for use",
    });
    expect(
      (await caller.work.projects.list()).find(
        (item) => item.projectId === project.projectId,
      ),
    ).toMatchObject({ ownerName: "Dev Partner", health: "complete" });
    expect(
      (await caller.work.goals.list()).find(
        (item) => item.goalId === goal.goalId,
      ),
    ).toMatchObject({ ownerName: "Dev Partner", status: "on_track" });
    expect(
      (await caller.work.portfolios.list()).find(
        (item) => item.portfolioId === portfolio.portfolioId,
      ),
    ).toMatchObject({ ownerName: "Dev Partner" });
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
    await caller.work.workload.upsert({
      projectId: secondProject.projectId,
      employeeId,
      weekStart: "2026-07-20",
      allocatedMinutes: 600,
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
    expect(
      await caller.work.workload.portfolio({
        portfolioId: portfolio.portfolioId,
        weekStart: "2026-07-20",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ allocatedMinutes: 3_000, utilization: 125 }),
      ]),
    );
    expect(
      await caller.work.reporting.portfolioChart({
        portfolioId: portfolio.portfolioId,
        spec: {
          groupBy: "project",
          metric: "task_count",
          completion: "all",
          dueFrom: null,
          dueTo: null,
          includeSubtasks: true,
          customFieldId: null,
        },
      }),
    ).toEqual({
      data: [{ label: "Planning pilot", value: 1 }],
      total: 1,
    });
    const portfolioDashboard = await caller.work.reporting.saveDashboard({
      name: "Portfolio delivery",
      config: {
        portfolioId: portfolio.portfolioId,
        chartStyle: "bar",
        spec: {
          groupBy: "project",
          metric: "task_count",
          completion: "all",
          dueFrom: null,
          dueTo: null,
          includeSubtasks: true,
          customFieldId: null,
        },
      },
    });
    expect(await caller.work.reporting.dashboards()).toContainEqual(
      portfolioDashboard,
    );
    const projectReportDashboard = await caller.work.reporting.saveDashboard({
      name: "Visible project health",
      config: {
        reportType: "projects",
        chartStyle: "donut",
        spec: {
          groupBy: "project_health",
          ownerEmployeeId: employeeId,
          status: "complete",
          privacy: "private",
          sourcePlatform: "native",
        },
      },
    });
    const goalReportDashboard = await caller.work.reporting.saveDashboard({
      name: "Goal health",
      config: {
        reportType: "goals",
        chartStyle: "bar",
        spec: {
          groupBy: "goal_status",
          ownerEmployeeId: employeeId,
          status: "on_track",
          scope: "company",
          timePeriod: "Q3 2026",
          includeSubgoals: false,
        },
      },
    });
    const portfolioReportDashboard = await caller.work.reporting.saveDashboard({
      name: "Portfolio health",
      config: {
        reportType: "portfolios",
        chartStyle: "number",
        spec: {
          groupBy: "portfolio_health",
          ownerEmployeeId: employeeId,
          status: "on_track",
          privacy: "organization",
        },
      },
    });
    expect(await caller.work.reporting.dashboards()).toEqual(
      expect.arrayContaining([
        projectReportDashboard,
        goalReportDashboard,
        portfolioReportDashboard,
      ]),
    );
    await expect(
      caller.work.reporting.saveDashboard({
        name: "Invalid mixed report",
        config: {
          reportType: "goals",
          chartStyle: "bar",
          spec: { groupBy: "project_health" },
        },
      }),
    ).rejects.toThrow("Group does not match the report type");
    await expect(
      caller.work.reporting.saveDashboard({
        name: "Invalid goal filter",
        config: {
          reportType: "goals",
          chartStyle: "bar",
          spec: {
            groupBy: "goal_status",
            privacy: "organization",
          },
        },
      }),
    ).rejects.toThrow("Filter does not match the report type");
    await expect(
      caller.work.reporting.portfolioChart({
        portfolioId: portfolio.portfolioId,
        spec: {
          groupBy: "custom_field",
          metric: "task_count",
          completion: "all",
          dueFrom: null,
          dueTo: null,
          includeSubtasks: true,
          customFieldId: "a0000000-0000-4000-8000-000000000001",
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(secondProject.projectId)!.clientId = clientId;
    await caller.admin.features.setOverride({
      featureKey: "work.workload",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "client disabled portfolio workload",
    });
    expect(
      await caller.work.workload.portfolio({
        portfolioId: portfolio.portfolioId,
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
    expect(
      await caller.work.reporting.chart({
        projectId: project.projectId,
        spec: {
          groupBy: "completion",
          metric: "estimated_minutes",
          completion: "all",
          dueFrom: "2026-07-20",
          dueTo: "2026-07-31",
          includeSubtasks: false,
          customFieldId: null,
        },
      }),
    ).toEqual({
      data: [{ label: "Complete", value: 480 }],
      total: 480,
    });
    const reportingField = await caller.work.customFields.create({
      projectId: project.projectId,
      name: "Delivery confidence",
      fieldType: "single_select",
      options: ["High", "Low"],
      isRequired: false,
    });
    await caller.work.customFields.setValue({
      itemId: task.itemId,
      customFieldId: reportingField.customFieldId,
      value: "High",
    });
    const customFieldSpec = {
      groupBy: "custom_field" as const,
      metric: "task_count" as const,
      completion: "all" as const,
      dueFrom: null,
      dueTo: null,
      includeSubtasks: true,
      customFieldId: reportingField.customFieldId,
    };
    expect(
      await caller.work.reporting.chart({
        projectId: project.projectId,
        spec: customFieldSpec,
      }),
    ).toEqual({ data: [{ label: "High", value: 1 }], total: 1 });
    const customFieldDashboard = await caller.work.reporting.saveDashboard({
      name: "Confidence view",
      config: {
        projectId: project.projectId,
        chartStyle: "bar",
        spec: customFieldSpec,
      },
    });
    const reportingClientId = resolveDevUser("portal_b").clientId!;
    getDemoWork().projects.get(project.projectId)!.clientId = reportingClientId;
    await caller.admin.features.setOverride({
      featureKey: "work.custom_fields",
      scopeType: "client",
      scopeKey: reportingClientId,
      enabled: false,
      reason: "client disabled custom fields",
    });
    expect(await caller.work.reporting.dashboards()).not.toContainEqual(
      customFieldDashboard,
    );
    await expect(
      caller.work.reporting.chart({
        projectId: project.projectId,
        spec: customFieldSpec,
      }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.custom_fields" });
    await caller.admin.features.setOverride({
      featureKey: "work.custom_fields",
      scopeType: "client",
      scopeKey: reportingClientId,
      enabled: true,
      reason: "restore custom fields",
    });
    await expect(
      caller.work.reporting.chart({
        projectId: project.projectId,
        spec: {
          groupBy: "completion",
          metric: "task_count",
          completion: "all",
          dueFrom: "2026-07-31",
          dueTo: "2026-07-20",
          includeSubtasks: true,
          customFieldId: null,
        },
      }),
    ).rejects.toThrow("Due through must be on or after due from");

    const budget = await caller.work.budgets.update({
      projectId: project.projectId,
      budgetAmount: 1_000,
      budgetCurrency: "AED",
      hourlyCostRate: 100,
    });
    expect(budget).toMatchObject({ actualCost: 200, variance: 800 });
    await caller.work.budgets.setRate({
      projectId: project.projectId,
      employeeId,
      hourlyCostRate: 175,
    });
    expect(
      await caller.work.budgets.rates({ projectId: project.projectId }),
    ).toContainEqual({
      projectId: project.projectId,
      employeeId,
      employeeName: "Dev Partner",
      hourlyCostRate: 175,
    });
    expect(
      await caller.work.budgets.summary({ projectId: project.projectId }),
    ).toMatchObject({ actualCost: 350, forecastCost: 350, variance: 650 });
    await expect(
      caller.work.budgets.setRate({
        projectId: project.projectId,
        employeeId: "c0000000-0000-4000-8000-000000000099",
        hourlyCostRate: 50,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const dashboard = await caller.work.reporting.saveDashboard({
      name: "Planning view",
      config: { projectId: project.projectId },
    });
    expect(await caller.work.reporting.dashboards()).toContainEqual(dashboard);
    const sharedViewer = amCaller();
    expect(await sharedViewer.work.reporting.dashboards()).not.toContainEqual(
      expect.objectContaining({ dashboardId: dashboard.dashboardId }),
    );
    await caller.work.reporting.shareDashboard({
      dashboardId: dashboard.dashboardId,
      visibility: "organization",
      viewerEmployeeIds: [],
    });
    expect(await sharedViewer.work.reporting.dashboards()).toContainEqual(
      expect.objectContaining({
        dashboardId: dashboard.dashboardId,
        currentAccess: "viewer",
        viewerEmployeeIds: [],
      }),
    );
    const shared = await caller.work.reporting.shareDashboard({
      dashboardId: dashboard.dashboardId,
      visibility: "private",
      viewerEmployeeIds: [resolveDevUser("am").employeeId],
    });
    expect(shared).toMatchObject({
      visibility: "private",
      viewerEmployeeIds: [resolveDevUser("am").employeeId],
      currentAccess: "admin",
    });
    expect(await sharedViewer.work.reporting.dashboards()).toContainEqual(
      expect.objectContaining({
        dashboardId: dashboard.dashboardId,
        currentAccess: "viewer",
      }),
    );
    await expect(
      sharedViewer.work.reporting.saveDashboard({
        dashboardId: dashboard.dashboardId,
        name: "Viewer edit",
        config: { projectId: project.projectId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      sharedViewer.work.reporting.deleteDashboard({
        dashboardId: dashboard.dashboardId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller.admin.features.setOverride({
      featureKey: "work.reporting_dashboards",
      scopeType: "client",
      scopeKey: reportingClientId,
      enabled: false,
      reason: "client disabled reporting",
    });
    expect(await caller.work.reporting.dashboards()).not.toContainEqual(
      dashboard,
    );
    expect(await sharedViewer.work.reporting.dashboards()).not.toContainEqual(
      expect.objectContaining({ dashboardId: dashboard.dashboardId }),
    );
    expect(
      await caller.work.reporting.portfolioChart({
        portfolioId: portfolio.portfolioId,
        spec: {
          groupBy: "project",
          metric: "task_count",
          completion: "all",
          dueFrom: null,
          dueTo: null,
          includeSubtasks: true,
          customFieldId: null,
        },
      }),
    ).toEqual({ data: [], total: 0 });
    await expect(
      caller.work.reporting.chart({
        projectId: project.projectId,
        spec: {
          groupBy: "completion",
          metric: "task_count",
          completion: "all",
          dueFrom: null,
          dueTo: null,
          includeSubtasks: true,
          customFieldId: null,
        },
      }),
    ).rejects.toMatchObject({
      message: "FEATURE_DISABLED:work.reporting_dashboards",
    });
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
    expect(await caller.work.reporting.dashboards()).not.toContainEqual(
      expect.objectContaining({ dashboardId: goalReportDashboard.dashboardId }),
    );
    await caller.admin.features.setOverride({
      featureKey: "work.status_updates",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    expect(await caller.work.reporting.dashboards()).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          dashboardId: projectReportDashboard.dashboardId,
        }),
        expect.objectContaining({
          dashboardId: portfolioReportDashboard.dashboardId,
        }),
      ]),
    );
    await caller.admin.features.setOverride({
      featureKey: "work.portfolios",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    expect(await caller.work.reporting.dashboards()).not.toContainEqual(
      expect.objectContaining({
        dashboardId: portfolioReportDashboard.dashboardId,
      }),
    );
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
