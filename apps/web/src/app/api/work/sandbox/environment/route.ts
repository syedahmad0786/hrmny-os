import { z } from "zod";
import {
  bootstrapSandboxDatabase,
  currentWorkEnvironmentManifest,
  resetSandboxDatabase,
  sandboxRequestAuthorized,
} from "@/server/work-sandbox";

export const runtime = "nodejs";

const bootstrap = z.object({
  administrator: z.object({
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(320),
    jobTitle: z.string().max(160).nullable(),
    department: z.string().max(160).nullable(),
    reportsToEmail: z.string().email().max(320).nullable(),
    capacityHoursPerWeek: z.string().max(16).nullable(),
    authUserId: z.string().uuid().nullable(),
    roleKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).max(100),
  }),
  roles: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
        displayName: z.string().trim().min(1).max(160),
        legacyTitles: z.array(z.string().max(160)).max(100),
      }),
    )
    .min(1)
    .max(100),
  policies: z
    .array(
      z.object({
        roleKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
        resource: z.string().regex(/^[a-z0-9_*.-]{1,120}$/),
        action: z.string().regex(/^[a-z0-9_*.-]{1,120}$/),
        effect: z.enum(["allow", "deny"]),
      }),
    )
    .max(2_000),
  featureOverrides: z
    .array(
      z.object({
        featureKey: z.string().regex(/^[a-z0-9_.-]{1,160}$/),
        enabled: z.boolean(),
        reason: z.string().max(500).nullable(),
      }),
    )
    .max(1_000),
  organizationPolicy: z.object({
    approvedDomains: z.array(z.string().min(1).max(253)).max(100),
    defaultProjectPrivacy: z.enum(["organization", "private"]),
    defaultTeamPrivacy: z.enum(["public", "request", "private"]),
    guestInvitePolicy: z.enum(["admins", "members", "disabled"]),
    externalSharingEnabled: z.boolean(),
    appPolicy: z.enum(["allow_all", "approved_only", "disabled"]),
    sessionTimeoutMinutes: z.number().int().min(15).max(43_200),
  }),
});

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function failure(error: unknown) {
  return Response.json(
    {
      error: error instanceof Error ? error.message : "Sandbox request failed",
    },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  if (!sandboxRequestAuthorized(request.headers.get("authorization")))
    return unauthorized();
  try {
    return Response.json(
      await currentWorkEnvironmentManifest(new URL(request.url).origin),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!sandboxRequestAuthorized(request.headers.get("authorization")))
    return unauthorized();
  try {
    return Response.json(
      await bootstrapSandboxDatabase(bootstrap.parse(await request.json())),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  if (!sandboxRequestAuthorized(request.headers.get("authorization")))
    return unauthorized();
  try {
    const input = z
      .object({ environmentId: z.string().trim().min(1).max(160) })
      .parse(await request.json());
    return Response.json(await resetSandboxDatabase(input.environmentId));
  } catch (error) {
    return failure(error);
  }
}
