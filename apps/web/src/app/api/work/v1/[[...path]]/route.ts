import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import {
  authenticateWorkApiRequest,
  type WorkApiScope,
} from "@/server/work-api";
import { createCaller } from "@/server/trpc/root";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ path?: string[] }> };
const headers = { "x-hrmny-api-version": "2026-07-24" };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers });
}

function apiError(error: unknown) {
  if (error instanceof ZodError)
    return json(
      { error: { code: "invalid_request", message: error.issues[0]?.message } },
      400,
    );
  if (error instanceof TRPCError) {
    const status =
      error.code === "PAYLOAD_TOO_LARGE"
        ? 413
        : error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "UNAUTHORIZED"
              ? 401
              : error.code === "CONFLICT"
                ? 409
                : 400;
    return json(
      { error: { code: error.code.toLowerCase(), message: error.message } },
      status,
    );
  }
  console.error("Work API request failed", error);
  return json(
    {
      error: {
        code: "internal_error",
        message: "Request could not be completed",
      },
    },
    500,
  );
}

async function body(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 1_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE" });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1_000_000)
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE" });
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid JSON body" });
  }
}

async function authorized(request: Request, scope: WorkApiScope) {
  const auth = await authenticateWorkApiRequest(request, scope);
  if (!auth)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid credential or missing scope",
    });
  return createCaller(auth.context).work;
}

export async function GET(request: Request, context: Context) {
  try {
    const path = (await context.params).path ?? [];
    if (path.length === 1 && path[0] === "projects") {
      const work = await authorized(request, "projects:read");
      return json({ data: await work.projects.list() });
    }
    if (path.length === 2 && path[0] === "projects") {
      const work = await authorized(request, "projects:read");
      return json({ data: await work.projects.get({ projectId: path[1]! }) });
    }
    if (path.length === 3 && path[0] === "projects" && path[2] === "tasks") {
      const work = await authorized(request, "tasks:read");
      const project = await work.projects.get({ projectId: path[1]! });
      return json({ data: project.items });
    }
    if (path.length === 2 && path[0] === "tasks") {
      const work = await authorized(request, "tasks:read");
      return json({ data: await work.tasks.get({ itemId: path[1]! }) });
    }
    if (path.length === 3 && path[0] === "tasks" && path[2] === "comments") {
      const work = await authorized(request, "comments:read");
      return json({ data: await work.comments.list({ itemId: path[1]! }) });
    }
    return json(
      { error: { code: "not_found", message: "Endpoint not found" } },
      404,
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const path = (await context.params).path ?? [];
    if (path.length === 1 && path[0] === "projects") {
      const work = await authorized(request, "projects:write");
      return json(
        { data: await work.projects.create((await body(request)) as never) },
        201,
      );
    }
    if (path.length === 1 && path[0] === "tasks") {
      const work = await authorized(request, "tasks:write");
      return json(
        { data: await work.tasks.create((await body(request)) as never) },
        201,
      );
    }
    if (path.length === 3 && path[0] === "tasks" && path[2] === "comments") {
      const work = await authorized(request, "comments:write");
      return json(
        {
          data: await work.comments.create({
            ...(await body(request)),
            itemId: path[1]!,
          } as never),
        },
        201,
      );
    }
    if (path.length === 3 && path[0] === "tasks" && path[2] === "complete") {
      const work = await authorized(request, "tasks:write");
      const input = await body(request);
      return json({
        data: await work.tasks.complete({
          itemId: path[1]!,
          completed: input.completed ?? true,
        } as never),
      });
    }
    return json(
      { error: { code: "not_found", message: "Endpoint not found" } },
      404,
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const path = (await context.params).path ?? [];
    if (path.length === 2 && path[0] === "tasks") {
      const work = await authorized(request, "tasks:write");
      return json({
        data: await work.tasks.update({
          ...(await body(request)),
          itemId: path[1]!,
        } as never),
      });
    }
    return json(
      { error: { code: "not_found", message: "Endpoint not found" } },
      404,
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const path = (await context.params).path ?? [];
    if (path.length === 2 && path[0] === "projects") {
      const work = await authorized(request, "projects:write");
      return json({
        data: await work.projects.archive({ projectId: path[1]! }),
      });
    }
    if (path.length === 2 && path[0] === "tasks") {
      const work = await authorized(request, "tasks:write");
      return json({ data: await work.tasks.archive({ itemId: path[1]! }) });
    }
    return json(
      { error: { code: "not_found", message: "Endpoint not found" } },
      404,
    );
  } catch (error) {
    return apiError(error);
  }
}
