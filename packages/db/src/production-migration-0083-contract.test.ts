import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("migration 0083 Google identity history boundary", () => {
  it("makes binding provenance immutable and revocation one-way", () => {
    const migration = readFileSync(
      new URL(
        "../migrations/0083_employee_google_identity.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const table = migration.indexOf(
      "CREATE TABLE IF NOT EXISTS public.employee_google_identity",
    );
    const fn = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.enforce_employee_google_identity_history()",
    );
    const trigger = migration.indexOf(
      "CREATE TRIGGER enforce_employee_google_identity_history",
    );
    expect(table).toBeGreaterThanOrEqual(0);
    expect(fn).toBeGreaterThan(table);
    expect(trigger).toBeGreaterThan(fn);
    expect(migration).toMatch(
      /NEW\.google_subject[\s\S]+OLD\.google_subject[\s\S]+binding and claim provenance are immutable/,
    );
    expect(migration).toMatch(
      /OLD\.revoked_at IS NOT NULL[\s\S]+Google identity revocation is immutable/,
    );
    expect(migration).toMatch(
      /revoked_at IS NOT NULL AND revoked_by_employee_id IS NOT NULL AND revocation_reason IS NOT NULL/,
    );
    expect(migration).toMatch(
      /TG_OP IN \('DELETE', 'TRUNCATE'\)[\s\S]+Google identity history cannot be deleted/,
    );
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.employee_google_identity",
    );
    expect(migration).toContain(
      "BEFORE TRUNCATE ON public.employee_google_identity",
    );
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role",
    );
    expect(migration).not.toContain(
      "GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role",
    );
  });
});
