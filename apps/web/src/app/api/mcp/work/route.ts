import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { featureEnabled } from "@/server/features";
import { authenticateWorkApiToken, type WorkApiScope } from "@/server/work-api";
import { createCaller } from "@/server/trpc/root";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const toolScopes: Record<string, WorkApiScope> = {
  list_projects: "projects:read",
  get_project: "projects:read",
  get_task: "tasks:read",
  list_task_comments: "comments:read",
  create_project: "projects:write",
  archive_project: "projects:write",
  create_task: "tasks:write",
  update_task: "tasks:write",
  complete_task: "tasks:write",
  archive_task: "tasks:write",
  add_task_comment: "comments:write",
};

const tools = [
  {
    name: "list_projects",
    description: "List projects the authenticated user can access.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_project",
    description: "Get a project with its sections, tasks, and relationships.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", format: "uuid" } },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_task",
    description: "Get one accessible task, milestone, or approval.",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string", format: "uuid" } },
      required: ["itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_task_comments",
    description: "List comments on an accessible task.",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string", format: "uuid" } },
      required: ["itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_project",
    description: "Create a project as the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: "string", maxLength: 20000 },
        privacy: { type: "string", enum: ["organization", "private"] },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "archive_project",
    description: "Archive an accessible project the user can administer.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", format: "uuid" } },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description: "Create a task, milestone, approval, or subtask in a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", format: "uuid" },
        sectionId: { type: ["string", "null"], format: "uuid" },
        parentItemId: { type: ["string", "null"], format: "uuid" },
        title: { type: "string", minLength: 1, maxLength: 500 },
        description: { type: "string", maxLength: 20000 },
        itemType: { type: "string", enum: ["task", "milestone", "approval"] },
        priority: {
          type: ["string", "null"],
          enum: ["low", "medium", "high", "urgent", null],
        },
        assigneeEmployeeId: { type: ["string", "null"], format: "uuid" },
        startDate: { type: ["string", "null"], format: "date" },
        dueAt: { type: ["string", "null"], format: "date-time" },
      },
      required: ["projectId", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: "Update fields on an accessible task.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", format: "uuid" },
        title: { type: "string", minLength: 1, maxLength: 500 },
        description: { type: "string", maxLength: 20000 },
        priority: {
          type: ["string", "null"],
          enum: ["low", "medium", "high", "urgent", null],
        },
        assigneeEmployeeId: { type: ["string", "null"], format: "uuid" },
        startDate: { type: ["string", "null"], format: "date" },
        dueAt: { type: ["string", "null"], format: "date-time" },
      },
      required: ["itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    description: "Mark an accessible task complete or incomplete.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", format: "uuid" },
        completed: { type: "boolean" },
      },
      required: ["itemId", "completed"],
      additionalProperties: false,
    },
  },
  {
    name: "archive_task",
    description: "Archive an accessible task.",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string", format: "uuid" } },
      required: ["itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "add_task_comment",
    description:
      "Add a comment to an accessible task as the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", format: "uuid" },
        body: { type: "string", minLength: 1, maxLength: 20000 },
      },
      required: ["itemId", "body"],
      additionalProperties: false,
    },
  },
] as const;

const uuid = z.string().uuid();
const idInput = z.object({ itemId: uuid }).strict();
const projectInput = z.object({ projectId: uuid }).strict();
const createProjectInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(20_000).default(""),
    privacy: z.enum(["organization", "private"]).default("organization"),
  })
  .strict();
const createTaskInput = z
  .object({
    projectId: uuid,
    sectionId: uuid.nullable().optional(),
    parentItemId: uuid.nullable().optional(),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(20_000).default(""),
    itemType: z.enum(["task", "milestone", "approval"]).default("task"),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
    assigneeEmployeeId: uuid.nullable().optional(),
    startDate: z.string().date().nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict();
const updateTaskInput = z
  .object({
    itemId: uuid,
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(20_000).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
    assigneeEmployeeId: uuid.nullable().optional(),
    startDate: z.string().date().nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict();

function rpc(id: string | number | null, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  status = 200,
) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status },
  );
}

function toolResult(data: unknown) {
  const structuredContent = { data };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

async function callTool(
  name: string,
  args: unknown,
  context: NonNullable<
    Awaited<ReturnType<typeof authenticateWorkApiToken>>
  >["context"],
) {
  const work = createCaller(context).work;
  switch (name) {
    case "list_projects":
      z.object({})
        .strict()
        .parse(args ?? {});
      return work.projects.list();
    case "get_project":
      return work.projects.get(projectInput.parse(args));
    case "get_task":
      return work.tasks.get(idInput.parse(args));
    case "list_task_comments":
      return work.comments.list(idInput.parse(args));
    case "create_project": {
      const input = createProjectInput.parse(args);
      return work.projects.create({ ...input, color: "#C7702E" });
    }
    case "archive_project":
      return work.projects.archive(projectInput.parse(args));
    case "create_task":
      return work.tasks.create(createTaskInput.parse(args));
    case "update_task":
      return work.tasks.update(updateTaskInput.parse(args));
    case "complete_task":
      return work.tasks.complete(
        z.object({ itemId: uuid, completed: z.boolean() }).strict().parse(args),
      );
    case "archive_task":
      return work.tasks.archive(idInput.parse(args));
    case "add_task_comment":
      return work.comments.create(
        z
          .object({ itemId: uuid, body: z.string().trim().min(1).max(20_000) })
          .strict()
          .parse(args),
      );
    default:
      throw new TRPCError({ code: "NOT_FOUND", message: "Unknown MCP tool" });
  }
}

export async function POST(request: Request) {
  const authenticated = await authenticateWorkApiToken(request);
  if (!authenticated) return rpcError(null, -32001, "Unauthorized", 401);
  if (
    !(await featureEnabled("work.ai.connectors", {
      userId: authenticated.identity.employeeId,
      roles: authenticated.identity.roles,
    }))
  )
    return rpcError(null, -32003, "AI connectors are disabled", 403);

  let body: {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: unknown;
  };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1_000_000)
      return rpcError(null, -32600, "Request is too large", 413);
    body = JSON.parse(raw) as typeof body;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  const id = body.id ?? null;
  if (body.jsonrpc !== "2.0" || !body.method)
    return rpcError(id, -32600, "Invalid Request", 400);
  if (body.method === "notifications/initialized")
    return new Response(null, { status: 202 });
  if (body.method === "initialize")
    return rpc(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "hrmny Work", version: "1.0.0" },
    });
  if (body.method === "ping") return rpc(id, {});
  if (body.method === "tools/list")
    return rpc(id, {
      tools: tools.filter((tool) =>
        authenticated.identity.scopes.includes(toolScopes[tool.name]!),
      ),
    });
  if (body.method === "tools/call") {
    const parsed = z
      .object({ name: z.string(), arguments: z.unknown().optional() })
      .safeParse(body.params);
    if (!parsed.success) return rpcError(id, -32602, "Invalid tool call");
    const requiredScope = toolScopes[parsed.data.name];
    if (!requiredScope) return rpcError(id, -32602, "Unknown tool");
    if (!authenticated.identity.scopes.includes(requiredScope))
      return rpcError(id, -32003, `Missing scope: ${requiredScope}`);
    try {
      return rpc(
        id,
        toolResult(
          await callTool(
            parsed.data.name,
            parsed.data.arguments ?? {},
            authenticated.context,
          ),
        ),
      );
    } catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof TRPCError))
        console.error("Work MCP tool failed", error);
      const message =
        error instanceof z.ZodError
          ? (error.issues[0]?.message ?? "Invalid tool input")
          : error instanceof TRPCError
            ? error.message
            : "Tool failed";
      return rpc(id, {
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  }
  return rpcError(id, -32601, "Method not found");
}

export function GET() {
  return new Response("Use an MCP Streamable HTTP client", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
