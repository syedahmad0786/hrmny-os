import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { clearDemoFeatureOverrides } from "./features";
import { clearDemoWorkAi } from "./work-ai";
import { getDemoWork } from "./trpc/work-management-router";
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

describe("governed Work AI", () => {
  beforeEach(() => {
    clearDemoFeatureOverrides();
    clearDemoWorkAi();
  });

  it("uses only accessible Work context and applies proposals explicitly", async () => {
    const caller = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.ai.smart_chat",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const project = await caller.work.projects.create({
      name: `AI test ${crypto.randomUUID()}`,
      description: "Safe project context",
      privacy: "private",
      color: "#C7702E",
    });
    await caller.work.tasks.create({
      projectId: project.projectId,
      title: "Existing source task",
      description: "Evidence",
      itemType: "task",
    });
    const run = await caller.workAi.generate({
      kind: "smart_chat",
      requestText: "Create a task to review the launch plan",
      projectIds: [project.projectId],
      itemId: null,
    });

    expect(
      run.result?.sources.some((source) => source.id === project.projectId),
    ).toBe(true);
    expect(run.result?.actions[0]?.type).toBe("create_task");
    const before = await caller.work.projects.get({
      projectId: project.projectId,
    });
    await caller.workAi.applyAction({ runId: run.runId, actionIndex: 0 });
    const after = await caller.work.projects.get({
      projectId: project.projectId,
    });
    expect(after.items).toHaveLength(before.items.length + 1);
    await expect(
      caller.workAi.applyAction({ runId: run.runId, actionIndex: 0 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const rejected = await caller.workAi.generate({
      kind: "smart_chat",
      requestText: "Create a task that should be rejected",
      projectIds: [project.projectId],
      itemId: null,
    });
    await caller.workAi.reject({ runId: rejected.runId });
    await expect(
      caller.workAi.applyAction({ runId: rejected.runId, actionIndex: 0 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("accepts validated Smart Chat image context only when Attachments is enabled", async () => {
    const caller = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.ai.smart_chat",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const png = "iVBORw0KGgoAAAANSUhEUg==";
    const run = await caller.workAi.generate({
      kind: "smart_chat",
      requestText: "Describe this image",
      projectIds: [],
      itemId: null,
      images: [{ name: "brief.png", mediaType: "image/png", dataBase64: png }],
    });
    expect(run.result?.sources).toContainEqual(
      expect.objectContaining({ id: "image:0", type: "image" }),
    );
    await expect(
      caller.workAi.generate({
        kind: "smart_chat",
        requestText: "Describe this image",
        projectIds: [],
        itemId: null,
        images: [
          { name: "fake.jpg", mediaType: "image/jpeg", dataBase64: png },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const oversizedPng = Buffer.concat([
      Buffer.from(png, "base64"),
      Buffer.alloc(1_100_000),
    ]).toString("base64");
    await expect(
      caller.workAi.generate({
        kind: "smart_chat",
        requestText: "Describe these images",
        projectIds: [],
        itemId: null,
        images: Array.from({ length: 3 }, (_, index) => ({
          name: `large-${index}.png`,
          mediaType: "image/png" as const,
          dataBase64: oversizedPng,
        })),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });

    const project = await caller.work.projects.create({
      name: `Image project ${crypto.randomUUID()}`,
      description: "Client-scoped image context",
      privacy: "private",
      color: "#C7702E",
    });
    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(project.projectId)!.clientId = clientId;
    await caller.admin.features.setOverride({
      featureKey: "work.attachments",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.workAi.generate({
        kind: "smart_chat",
        requestText: "Describe this image for the client",
        projectIds: [project.projectId],
        itemId: null,
        images: [
          { name: "brief.png", mediaType: "image/png", dataBase64: png },
        ],
      }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.attachments" });
    const filteredOverview = await caller.workAi.generate({
      kind: "smart_chat",
      requestText: "Describe this image across visible projects",
      projectIds: [],
      itemId: null,
      allProjects: true,
      images: [{ name: "brief.png", mediaType: "image/png", dataBase64: png }],
    });
    expect(filteredOverview.result?.sources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: project.projectId }),
      ]),
    );

    await caller.admin.features.setOverride({
      featureKey: "work.attachments",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.workAi.generate({
        kind: "smart_chat",
        requestText: "Describe this image",
        projectIds: [],
        itemId: null,
        images: [
          { name: "brief.png", mediaType: "image/png", dataBase64: png },
        ],
      }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.attachments" });
  });

  it("uses a permission-filtered workspace overview and relevant project detail", async () => {
    const caller = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.ai.smart_chat",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    await caller.work.projects.create({
      name: `Alphabetical ${crypto.randomUUID()}`,
      description: "Unrelated work",
      privacy: "private",
      color: "#C7702E",
    });
    const relevant = await caller.work.projects.create({
      name: `Mars launch ${crypto.randomUUID()}`,
      description: "Mission readiness",
      privacy: "private",
      color: "#C7702E",
    });
    const blocked = await caller.work.projects.create({
      name: `Venus confidential ${crypto.randomUUID()}`,
      description: "Restricted mission",
      privacy: "private",
      color: "#C7702E",
    });
    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(blocked.projectId)!.clientId = clientId;
    await caller.admin.features.setOverride({
      featureKey: "work.ai.smart_chat",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.workAi.generate({
        kind: "smart_chat",
        requestText: "Summarize the restricted mission",
        projectIds: [blocked.projectId],
        itemId: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const run = await caller.workAi.generate({
      kind: "smart_chat",
      requestText: "Create a task for the Mars launch",
      projectIds: [],
      itemId: null,
      allProjects: true,
    });
    expect(run.result?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "workspace:projects" }),
        expect.objectContaining({ id: relevant.projectId }),
      ]),
    );
    expect(run.result?.sources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: blocked.projectId })]),
    );
    expect(run.result?.actions[0]).toMatchObject({
      type: "create_task",
      projectId: relevant.projectId,
    });
  });

  it("fails closed when the capability is disabled", async () => {
    const caller = partnerCaller();
    await expect(
      caller.workAi.generate({
        kind: "smart_status",
        requestText: "Draft an update",
        projectIds: [],
        itemId: null,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "FEATURE_DISABLED:work.ai.smart_status",
    });
  });

  it("summarizes a permitted portfolio and Inbox", async () => {
    const caller = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.ai.smart_summaries",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const project = await caller.work.projects.create({
      name: `Summary project ${crypto.randomUUID()}`,
      description: "Portfolio evidence",
      privacy: "private",
      color: "#C7702E",
    });
    const portfolio = await caller.work.portfolios.create({
      name: `Summary portfolio ${crypto.randomUUID()}`,
      description: "Executive roll-up",
      privacy: "private",
    });
    await caller.work.portfolios.addProject({
      portfolioId: portfolio.portfolioId,
      projectId: project.projectId,
    });
    const notificationId = crypto.randomUUID();
    getDemoWork().notifications.set(notificationId, {
      notificationId,
      recipientEmployeeId: resolveDevUser("partner").employeeId,
      itemId: null,
      projectId: project.projectId,
      messageId: null,
      eventType: "assigned",
      message: "Review the portfolio risk",
      readAt: null,
      createdAt: new Date().toISOString(),
    });

    const run = await caller.workAi.generate({
      kind: "smart_summaries",
      requestText: "Summarize this portfolio and my Inbox",
      projectIds: [],
      itemId: null,
      summaryPortfolioId: portfolio.portfolioId,
      includeInbox: true,
    });
    expect(run.result?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: portfolio.portfolioId }),
        expect.objectContaining({
          id: `inbox:${resolveDevUser("partner").employeeId}`,
        }),
        expect.objectContaining({ id: project.projectId }),
      ]),
    );

    await caller.admin.features.setOverride({
      featureKey: "work.inbox",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "test",
    });
    await expect(
      caller.workAi.generate({
        kind: "smart_summaries",
        requestText: "Summarize my Inbox",
        projectIds: [],
        itemId: null,
        includeInbox: true,
      }),
    ).rejects.toMatchObject({ message: "FEATURE_DISABLED:work.inbox" });

    const clientId = resolveDevUser("portal_a").clientId!;
    getDemoWork().projects.get(project.projectId)!.clientId = clientId;
    await caller.admin.features.setOverride({
      featureKey: "work.projects",
      scopeType: "client",
      scopeKey: clientId,
      enabled: false,
      reason: "test",
    });
    const filteredPortfolio = await caller.workAi.generate({
      kind: "smart_summaries",
      requestText: "Summarize the portfolio",
      projectIds: [],
      itemId: null,
      summaryPortfolioId: portfolio.portfolioId,
    });
    expect(filteredPortfolio.result?.sources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: project.projectId }),
      ]),
    );
    await expect(
      caller.workAi.generate({
        kind: "smart_summaries",
        requestText: "Summarize the hidden project",
        projectIds: [project.projectId],
        itemId: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("drafts and applies portfolio and goal status updates", async () => {
    const caller = partnerCaller();
    await caller.admin.features.setOverride({
      featureKey: "work.ai.smart_status",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "test",
    });
    const portfolio = await caller.work.portfolios.create({
      name: `AI portfolio ${crypto.randomUUID()}`,
      description: "Portfolio status evidence",
      privacy: "private",
    });
    const goal = await caller.work.goals.create({
      name: `AI goal ${crypto.randomUUID()}`,
      description: "Goal status evidence",
      privacy: "private",
    });

    for (const target of [
      { targetType: "portfolio" as const, targetId: portfolio.portfolioId },
      { targetType: "goal" as const, targetId: goal.goalId },
    ]) {
      const run = await caller.workAi.generate({
        kind: "smart_status",
        requestText: "Draft an evidence-based status update",
        projectIds: [],
        itemId: null,
        statusTarget: target,
      });
      expect(run.result?.actions[0]).toMatchObject({
        type: "create_status",
        ...target,
      });
      await caller.workAi.applyAction({ runId: run.runId, actionIndex: 0 });
      await expect(
        caller.work.statusUpdates.list(target),
      ).resolves.toHaveLength(1);
    }
  });
});
