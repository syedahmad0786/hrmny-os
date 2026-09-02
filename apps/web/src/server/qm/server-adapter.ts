import { z } from "zod";
import type { SessionUser } from "../auth/session";
import { QmTrustedPrincipalSchema, type QmTrustedPrincipal } from "./contracts";

const QmStaffAuthoritySchema = z
  .object({
    authenticationSource: z.literal("verified-supabase"),
    organizationSource: z.literal("server-config"),
    organizationId: z.string().uuid(),
  })
  .strict();

export type QmStaffAuthority = z.infer<typeof QmStaffAuthoritySchema>;

/**
 * Converts only a server-authenticated, non-portal staff session. The explicit
 * authority object prevents organization identity from entering via a QM
 * command or browser payload. This is intentionally not wired to a route until
 * HRMNY defines the organization UUID and a default-denied qm:use permission.
 */
export function qmTrustedPrincipalFromStaffSession(
  user: Pick<SessionUser, "employeeId" | "actorType" | "clientId">,
  rawAuthority: unknown,
): QmTrustedPrincipal {
  if (user.actorType !== "staff" || user.clientId !== null) {
    throw new Error("QM_AUTHORIZATION_DENIED");
  }
  const authority = QmStaffAuthoritySchema.parse(rawAuthority);
  return QmTrustedPrincipalSchema.parse({
    organizationId: authority.organizationId,
    employeeId: user.employeeId,
  });
}
