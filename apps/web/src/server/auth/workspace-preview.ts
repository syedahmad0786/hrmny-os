import { employee, eq } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { canPreviewWorkspace } from "@/lib/workspace-preview";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import {
  DEV_USERS,
  getAuthMode,
  resolveActiveStaffById,
  type SessionUser,
} from "./session";

export async function workspacePreviewUsers(viewer: SessionUser | null) {
  if (!canPreviewWorkspace(viewer))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin workspace access required",
    });
  const db = getDb();
  if (!db && getAuthMode() === "dev")
    return Object.values(DEV_USERS)
      .filter((user) => user.actorType === "staff")
      .map(({ employeeId, displayName }) => ({ employeeId, displayName }));
  if (!db) throw new Error("Staff directory unavailable");
  return db
    .select({
      employeeId: employee.employeeId,
      displayName: employee.displayName,
    })
    .from(employee)
    .where(eq(employee.isActive, true))
    .orderBy(employee.displayName);
}

export async function resolveWorkspacePreview(
  viewer: SessionUser | null,
  employeeId: string,
) {
  if (!canPreviewWorkspace(viewer) || !viewer)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin workspace access required",
    });
  if (!z.string().uuid().safeParse(employeeId).success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an active employee",
    });
  const target =
    !getDb() && getAuthMode() === "dev"
      ? Object.values(DEV_USERS).find(
          (user) =>
            user.employeeId === employeeId && user.actorType === "staff",
        )
      : await resolveActiveStaffById(employeeId);
  if (!target || target.actorType !== "staff")
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This employee is no longer available for preview",
    });
  await writeAudit({
    actorEmployeeId: viewer.employeeId,
    action: "workspace.preview.read",
    entityType: "employee",
    entityId: target.employeeId,
    before: null,
    after: { readOnly: true },
    reason: "Admin operational workspace preview; private areas excluded",
  });
  return { viewer, target };
}
