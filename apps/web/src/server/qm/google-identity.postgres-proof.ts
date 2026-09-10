import { createDb, employee, sql } from "@hrmny/db";
import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { withDatabaseScope } from "../db";
import { resolveEmployeeGoogleIdentity } from "./google-identity";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("LOCAL_POSTGRES_PROOF_REQUIRED");
const db = createDb(databaseUrl);
const employeeIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const principals = employeeIds.map(
  (id, index) => `google-binding-${index}-${id}@hrmny.co`,
);
const subjects = [
  "910000000001",
  "910000000002",
  "910000000003",
  "910000000004",
];

beforeAll(async () => {
  await db.insert(employee).values(
    employeeIds.map((employeeId, index) => ({
      employeeId,
      displayName: `Google identity proof ${index}`,
      email: principals[index]!,
    })),
  );
});

const bind = (employeeId: string, qmPrincipal: string, googleSubject: string) =>
  db.execute(sql`
    insert into public.employee_google_identity (
      employee_id, qm_principal, google_issuer, google_subject,
      claim_method, claim_evidence_digest, claimed_by_employee_id
    ) values (
      ${employeeId}::uuid, ${qmPrincipal}, 'https://accounts.google.com', ${googleSubject},
      'admin-reviewed-google-proof', ${"a".repeat(64)}, ${employeeIds[0]}::uuid
    )
  `);
const resolve = (input: Parameters<typeof resolveEmployeeGoogleIdentity>[0]) =>
  withDatabaseScope(db, () => resolveEmployeeGoogleIdentity(input));

it("enforces unique stable identifiers and denies unbound, mismatched, inactive, and revoked identities", async () => {
  await bind(employeeIds[0]!, principals[0]!, subjects[0]!);
  await expect(
    bind(employeeIds[0]!, principals[1]!, subjects[1]!),
  ).rejects.toThrow();
  await expect(
    bind(employeeIds[1]!, principals[0]!, subjects[1]!),
  ).rejects.toThrow();
  await expect(
    bind(employeeIds[1]!, principals[1]!, subjects[0]!),
  ).rejects.toThrow();

  const oidc = {
    action: "resolve_identity" as const,
    proof: "oidc" as const,
    principal: principals[0]!,
    googleIssuer: "https://accounts.google.com" as const,
    googleSubject: subjects[0]!,
  };
  await expect(resolve(oidc)).resolves.toEqual({
    employeeId: employeeIds[0],
    principal: principals[0],
  });
  await expect(
    resolve({
      action: "resolve_identity",
      proof: "chat",
      googleChatUser: `users/${subjects[0]}`,
    }),
  ).resolves.toEqual({ employeeId: employeeIds[0], principal: principals[0] });
  await expect(
    resolve({ ...oidc, principal: principals[1]! }),
  ).resolves.toBeNull();
  await expect(
    resolve({ ...oidc, googleSubject: subjects[1]! }),
  ).resolves.toBeNull();
  await expect(
    resolve({
      action: "resolve_identity",
      proof: "chat",
      googleChatUser: `users/${subjects[1]}`,
    }),
  ).resolves.toBeNull();

  await db.execute(
    sql`update public.employee set is_active = false where employee_id = ${employeeIds[0]}::uuid`,
  );
  await expect(resolve(oidc)).resolves.toBeNull();
  await db.execute(
    sql`update public.employee set is_active = true where employee_id = ${employeeIds[0]}::uuid`,
  );
  await db.execute(sql`
    update public.employee_google_identity set
      revoked_at = now(), revoked_by_employee_id = ${employeeIds[0]}::uuid,
      revocation_reason = 'synthetic revocation proof'
    where employee_id = ${employeeIds[0]}::uuid
  `);
  await expect(resolve(oidc)).resolves.toBeNull();
});
