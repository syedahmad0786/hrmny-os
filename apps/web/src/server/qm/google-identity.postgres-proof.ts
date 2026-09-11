import { createDb, employee, sql } from "@hrmny/db";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { withDatabaseScope } from "../db";
import { resolveEmployeeGoogleIdentity } from "./google-identity";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("LOCAL_POSTGRES_PROOF_REQUIRED");
const db = createDb(databaseUrl);
type ProofTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
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

const bind = (
  tx: ProofTransaction,
  employeeId: string,
  qmPrincipal: string,
  googleSubject: string,
) =>
  tx.execute(sql`
    insert into public.employee_google_identity (
      employee_id, qm_principal, google_issuer, google_subject,
      claim_method, claim_evidence_digest, claimed_by_employee_id
    ) values (
      ${employeeId}::uuid, ${qmPrincipal}, 'https://accounts.google.com', ${googleSubject},
      'admin-reviewed-google-proof', ${"a".repeat(64)}, ${employeeIds[0]}::uuid
    )
  `);
const resolve = (
  tx: ProofTransaction,
  input: Parameters<typeof resolveEmployeeGoogleIdentity>[0],
) =>
  withDatabaseScope(tx as unknown as typeof db, () =>
    resolveEmployeeGoogleIdentity(input),
  );
const rejectWrite = (
  tx: ProofTransaction,
  write: (savepoint: ProofTransaction) => Promise<unknown>,
  message?: string,
) =>
  expect(tx.transaction((savepoint) => write(savepoint))).rejects.toThrow(
    message,
  );

it("enforces unique stable identifiers and denies unbound, mismatched, inactive, revoked, and deleted identities", async () => {
  await expect(
    db.transaction(async (tx) => {
      await tx.insert(employee).values(
        employeeIds.map((employeeId, index) => ({
          employeeId,
          displayName: `Google identity proof ${index}`,
          email: principals[index]!,
        })),
      );
      const privileges = await tx.execute(sql`
        select case when exists (select 1 from pg_roles where rolname = 'service_role')
          then has_table_privilege('service_role', 'public.employee_google_identity', 'SELECT,INSERT,UPDATE')
            and not has_table_privilege('service_role', 'public.employee_google_identity', 'DELETE')
            and not has_table_privilege('service_role', 'public.employee_google_identity', 'TRUNCATE')
          else true
        end as restricted
      `);
      expect(Array.from(privileges)[0]?.restricted).toBe(true);
      await bind(tx, employeeIds[0]!, principals[0]!, subjects[0]!);
      await bind(tx, employeeIds[1]!, principals[1]!, subjects[1]!);
      await rejectWrite(
        tx,
        (savepoint) =>
          savepoint.execute(sql`truncate public.employee_google_identity`),
        "history cannot be deleted",
      );
      await rejectWrite(
        tx,
        (savepoint) =>
          savepoint.execute(
            sql`delete from public.employee_google_identity where employee_id = ${employeeIds[1]}::uuid`,
          ),
        "history cannot be deleted",
      );
      await rejectWrite(tx, (savepoint) =>
        bind(savepoint, employeeIds[0]!, principals[1]!, subjects[1]!),
      );
      await rejectWrite(tx, (savepoint) =>
        bind(savepoint, employeeIds[2]!, principals[0]!, subjects[2]!),
      );
      await rejectWrite(tx, (savepoint) =>
        bind(savepoint, employeeIds[2]!, principals[2]!, subjects[0]!),
      );
      await rejectWrite(
        tx,
        (savepoint) =>
          savepoint.execute(sql`
      update public.employee_google_identity
      set google_subject = ${subjects[1]}
      where employee_id = ${employeeIds[0]}::uuid
    `),
        "binding and claim provenance are immutable",
      );

      const oidc = {
        action: "resolve_identity" as const,
        proof: "oidc" as const,
        principal: principals[0]!,
        googleIssuer: "https://accounts.google.com" as const,
        googleSubject: subjects[0]!,
      };
      await expect(resolve(tx, oidc)).resolves.toEqual({
        employeeId: employeeIds[0],
        principal: principals[0],
      });
      await expect(
        resolve(tx, {
          action: "resolve_identity",
          proof: "chat",
          googleChatUser: `users/${subjects[0]}`,
        }),
      ).resolves.toEqual({
        employeeId: employeeIds[0],
        principal: principals[0],
      });
      await expect(
        resolve(tx, { ...oidc, principal: principals[1]! }),
      ).resolves.toBeNull();
      await expect(
        resolve(tx, { ...oidc, googleSubject: subjects[1]! }),
      ).resolves.toBeNull();
      await expect(
        resolve(tx, {
          action: "resolve_identity",
          proof: "chat",
          googleChatUser: `users/${subjects[3]}`,
        }),
      ).resolves.toBeNull();

      await tx.execute(
        sql`update public.employee set is_active = false where employee_id = ${employeeIds[0]}::uuid`,
      );
      await expect(resolve(tx, oidc)).resolves.toBeNull();
      await tx.execute(
        sql`update public.employee set is_active = true where employee_id = ${employeeIds[0]}::uuid`,
      );
      await rejectWrite(tx, (savepoint) =>
        savepoint.execute(sql`
      update public.employee_google_identity set
        revoked_at = now(), revoked_by_employee_id = ${employeeIds[0]}::uuid,
        revocation_reason = null
      where employee_id = ${employeeIds[0]}::uuid
    `),
      );
      await tx.execute(sql`
    update public.employee_google_identity set
      revoked_at = now(), revoked_by_employee_id = ${employeeIds[0]}::uuid,
      revocation_reason = 'synthetic revocation proof'
    where employee_id = ${employeeIds[0]}::uuid
  `);
      await expect(resolve(tx, oidc)).resolves.toBeNull();
      await rejectWrite(
        tx,
        (savepoint) =>
          savepoint.execute(sql`
      update public.employee_google_identity set
        revoked_at = null, revoked_by_employee_id = null,
        revocation_reason = null
      where employee_id = ${employeeIds[0]}::uuid
    `),
        "revocation is immutable",
      );
      await rejectWrite(
        tx,
        (savepoint) =>
          savepoint.execute(sql`
      update public.employee_google_identity
      set revocation_reason = 'rewritten reason'
      where employee_id = ${employeeIds[0]}::uuid
    `),
        "revocation is immutable",
      );
      await rejectWrite(
        tx,
        (savepoint) =>
          savepoint.execute(
            sql`delete from public.employee_google_identity where employee_id = ${employeeIds[0]}::uuid`,
          ),
        "history cannot be deleted",
      );
      await rejectWrite(tx, (savepoint) =>
        bind(savepoint, employeeIds[0]!, principals[0]!, "910000000099"),
      );
      throw new Error("ROLLBACK_GOOGLE_IDENTITY_PROOF");
    }),
  ).rejects.toThrow("ROLLBACK_GOOGLE_IDENTITY_PROOF");
});
