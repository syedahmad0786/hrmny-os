import { z } from "zod";
import { sessionCanViewMargin, type SessionUser } from "../auth/session";
import { searchComposioConnectedData } from "../composio-connected-data-ai";
import { getVerifiedWorkAppConnection } from "../trpc/connections-router";
import { createCaller } from "../trpc/root";
import {
  requireItemAccess,
  requireProjectAccess,
} from "../trpc/work-management-router";
import { qmStaff } from "./staff-access";

const searchApp = z.enum([
  "one_drive",
  "outlook",
  "slack",
  "microsoft_teams",
  "jira",
]);
const connectedAccountId = z.string().min(1).max(200);
const inputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list_projects") }).strict(),
  z
    .object({
      operation: z.literal("get_project"),
      projectId: z.string().uuid(),
    })
    .strict(),
  z
    .object({ operation: z.literal("get_task"), itemId: z.string().uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("connection"),
      app: z.enum(["gmail", ...searchApp.options]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("connected_search"),
      app: searchApp,
      connectedAccountId,
      query: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({ operation: z.literal("gmail_profile"), connectedAccountId })
    .strict(),
  z
    .object({
      operation: z.literal("work_propose"),
      projectId: z.string().uuid(),
      requestText: z.string().trim().min(1).max(8_000),
    })
    .strict(),
]);

function context(user: SessionUser) {
  return {
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: null,
  };
}

export async function runQmOsTool(token: string, raw: unknown) {
  if (process.env.QM_OS_TOOLS_ENABLED !== "1")
    throw new Error("QM_OS_TOOLS_NOT_ENABLED");
  const input = inputSchema.parse(raw);
  const user = await qmStaff(token);
  const ctx = context(user);
  const caller = createCaller(ctx);
  let result: unknown;
  let usedConnection:
    { app: "gmail" | z.infer<typeof searchApp>; id: string } | undefined;

  switch (input.operation) {
    case "list_projects":
      result = await caller.work.projects.list();
      break;
    case "get_project":
      result = await caller.work.projects.get({ projectId: input.projectId });
      break;
    case "get_task":
      result = await caller.work.tasks.get({ itemId: input.itemId });
      break;
    case "work_propose": {
      const run = await caller.workAi.generate({
        kind: "smart_chat",
        projectIds: [input.projectId],
        requestText: input.requestText,
      });
      result = {
        runId: run.runId,
        status: run.status,
        result: run.result,
        nextLinks: [{ href: "/work/ai", label: "Review Work proposal" }],
      };
      break;
    }
    default: {
      const app = input.operation === "gmail_profile" ? "gmail" : input.app;
      const selectedId =
        input.operation === "connection" ? undefined : input.connectedAccountId;
      const verified = await getVerifiedWorkAppConnection(
        user.employeeId,
        app,
        {
          ...ctx,
          connectedAccountId: selectedId,
        },
      );
      if (!verified) {
        if (input.operation !== "connection")
          throw new Error("QM_CONNECTION_UNAVAILABLE");
        result = {
          app,
          connected: false,
          nextLinks: [
            { href: "/settings/connections", label: "Manage connections" },
          ],
        };
        break;
      }
      usedConnection = { app, id: verified.account.id };
      if (input.operation === "connection") {
        result = {
          app,
          connected: true,
          connectedAccountId: verified.account.id,
        };
      } else if (input.operation === "connected_search") {
        result = await searchComposioConnectedData({
          client: verified.client,
          connectedAccountId: verified.account.id,
          app: input.app,
          query: input.query,
        });
      } else {
        const response = await verified.client.proxy({
          connectedAccountId: verified.account.id,
          endpoint:
            "https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress",
          method: "GET",
        });
        if (response.status !== 200)
          throw new Error("QM_CONNECTION_UNAVAILABLE");
        const profile = z
          .object({ emailAddress: z.string().email() })
          .parse(response.data);
        result = {
          app,
          connectedAccountId: verified.account.id,
          emailAddress: profile.emailAddress,
        };
      }
    }
  }

  const current = await qmStaff(token);
  if (
    current.employeeId !== user.employeeId ||
    process.env.QM_OS_TOOLS_ENABLED !== "1"
  )
    throw new Error("QM_ACCESS_CHANGED");
  const currentCtx = context(current);
  if (input.operation === "get_project" || input.operation === "work_propose")
    await requireProjectAccess(
      {
        ...currentCtx,
        requestedFeatureKey:
          input.operation === "work_propose"
            ? "work.ai.smart_chat"
            : "work.projects",
      },
      input.projectId,
    );
  if (input.operation === "get_task")
    await requireItemAccess(
      { ...currentCtx, requestedFeatureKey: "work.tasks" },
      input.itemId,
    );
  if (input.operation === "list_projects") {
    const projects = await createCaller(currentCtx).work.projects.list();
    const visible = new Set(projects.map((project) => project.projectId));
    result = (result as typeof projects).filter((project) =>
      visible.has(project.projectId),
    );
  }
  if (
    usedConnection &&
    !(await getVerifiedWorkAppConnection(
      current.employeeId,
      usedConnection.app,
      {
        ...currentCtx,
        connectedAccountId: usedConnection.id,
      },
    ))
  )
    throw new Error("QM_CONNECTION_CHANGED");
  return result;
}
