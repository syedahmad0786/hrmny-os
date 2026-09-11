import { sql } from "@hrmny/db";
import { z } from "zod";
import { resolveActiveStaffById } from "../auth/session";
import { getDb } from "../db";

const principal = z
  .string()
  .max(320)
  .regex(/^[^@\s]+@hrmny\.co$/)
  .refine((value) => value === value.toLowerCase());
const subject = z.string().regex(/^[0-9]{1,255}$/);
const issuer = z.literal("https://accounts.google.com");

export const googleIdentityLookupRequest = z.discriminatedUnion("proof", [
  z
    .object({
      action: z.literal("resolve_identity"),
      proof: z.literal("oidc"),
      principal,
      googleIssuer: issuer,
      googleSubject: subject,
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve_identity"),
      proof: z.literal("chat"),
      googleChatUser: z.string().regex(/^users\/[0-9]{1,255}$/),
    })
    .strict(),
]);

export type GoogleIdentityLookup = z.infer<typeof googleIdentityLookupRequest>;

export async function resolveEmployeeGoogleIdentity(rawInput: unknown) {
  const input = googleIdentityLookupRequest.parse(rawInput);
  const db = getDb();
  if (!db) throw new Error("QM_GOOGLE_IDENTITY_DATABASE_REQUIRED");
  const googleSubject =
    input.proof === "chat"
      ? input.googleChatUser.slice("users/".length)
      : input.googleSubject;
  const [binding] = await db.execute<{
    employee_id: string;
    qm_principal: string;
  }>(sql`
    select employee_id, qm_principal
    from public.employee_google_identity
    where revoked_at is null
      and google_issuer = 'https://accounts.google.com'
      and google_subject = ${googleSubject}
      ${input.proof === "oidc" ? sql`and qm_principal = ${input.principal}` : sql``}
    limit 1
  `);
  if (!binding) return null;
  const staff = await resolveActiveStaffById(binding.employee_id);
  if (
    !staff ||
    staff.actorType !== "staff" ||
    staff.clientId !== null ||
    staff.email !== binding.qm_principal
  )
    return null;
  return { employeeId: staff.employeeId, principal: binding.qm_principal };
}
