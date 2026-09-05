import { z } from "zod";
import { sql } from "@hrmny/db";
import { CRM_MARKETS } from "@/lib/crm-markets";
import { getDb, withDatabaseScope } from "../db";
import { writeAudit } from "../m1-persistence";
import {
  createCompany,
  createContact,
  listCompanies,
  listContacts,
  normalizeDomain,
} from "./repository";

const nullableText = z.string().trim().max(1000).nullable().optional();
const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  sector: nullableText,
  market: z.enum(CRM_MARKETS).optional(),
  website: nullableText,
  linkedinUrl: nullableText,
});
const contactSchema = z.object({
  companyId: z.string().uuid().nullable().optional(),
  firstName: z.string().trim().min(1).max(200),
  lastName: nullableText,
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: nullableText,
  title: nullableText,
  linkedinUrl: nullableText,
});
type PlanRow = {
  row: number;
  action: "create" | "existing" | "invalid";
  name: string;
  message: string;
  recordId?: string;
  values: Record<string, unknown>;
};
const key = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();
function identity(row: {
  firstName: string;
  lastName?: string | null;
  companyId?: string | null;
}) {
  return `name:${key(row.firstName)}|${key(row.lastName)}|${row.companyId ?? ""}`;
}

export async function planCrmImport(
  kind: "companies" | "contacts",
  rawRows: Record<string, unknown>[],
): Promise<PlanRow[]> {
  const [companies, contacts] = await Promise.all([
    listCompanies(),
    listContacts(),
  ]);
  const known = new Map<string, string>();
  if (kind === "companies")
    for (const c of companies) {
      known.set(`name:${key(c.name)}`, c.companyId);
      const domain = normalizeDomain(c.website);
      if (domain) known.set(`domain:${domain}`, c.companyId);
    }
  else
    for (const c of contacts) {
      known.set(identity(c), c.contactId);
      if (c.email) known.set(`email:${key(c.email)}`, c.contactId);
      if (c.linkedinUrl)
        known.set(
          `linkedin:${key(c.linkedinUrl).replace(/\/$/, "")}`,
          c.contactId,
        );
    }
  return rawRows.map((raw, row): PlanRow => {
    const values = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [
        k,
        typeof v === "string" ? v.trim() || null : v,
      ]),
    );
    const invalid = (message: string): PlanRow => ({
      row,
      action: "invalid",
      name: String(values.name ?? values.firstName ?? `Row ${row + 1}`),
      message,
      values,
    });
    if (kind === "companies" && !values.market) delete values.market;
    if (kind === "contacts") {
      if (typeof values.email === "string")
        values.email = values.email.toLowerCase();
      if (!values.companyId && values.companyName) {
        const matches = companies.filter(
          (c) => key(c.name) === key(values.companyName),
        );
        if (matches.length !== 1)
          return invalid(
            matches.length
              ? "Company name is ambiguous. Select its exact CRM company ID."
              : "Company not found. Import companies first or select an existing company.",
          );
        values.companyId = matches[0]!.companyId;
      }
      if (
        values.companyId &&
        !companies.some((c) => c.companyId === values.companyId)
      )
        return invalid("Company ID does not exist.");
      if (
        typeof values.firstName === "string" &&
        values.firstName.includes("@")
      )
        return invalid(
          "An email address is in the first-name field. Map the name and email columns correctly.",
        );
    }
    const parsed = (
      kind === "companies" ? companySchema : contactSchema
    ).safeParse(values);
    if (!parsed.success)
      return invalid(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
    const data = parsed.data,
      keys: string[] = [];
    if ("name" in data) {
      keys.push(`name:${key(data.name)}`);
      const domain = normalizeDomain(data.website ?? null);
      if (domain) keys.push(`domain:${domain}`);
    } else {
      keys.push(identity(data));
      if (data.email) keys.unshift(`email:${key(data.email)}`);
      if (data.linkedinUrl)
        keys.unshift(`linkedin:${key(data.linkedinUrl).replace(/\/$/, "")}`);
    }
    const matches = Array.from(
      new Set(keys.map((k) => known.get(k)).filter((k): k is string => !!k)),
    );
    if (matches.length > 1)
      return invalid(
        "These fields match different records. Review the duplicates before importing.",
      );
    const match = matches[0];
    for (const k of keys) known.set(k, match ?? `incoming:${row}`);
    return {
      row,
      action: match ? "existing" : "create",
      name:
        "name" in data
          ? data.name
          : `${data.firstName} ${data.lastName ?? ""}`.trim(),
      message: match
        ? "Already present or repeated in this file; preserved without overwriting."
        : "Ready to create",
      ...(match && !match.startsWith("incoming:") ? { recordId: match } : {}),
      values: data,
    };
  });
}

let memoryImport = Promise.resolve();
export async function applyCrmImport(
  kind: "companies" | "contacts",
  rows: Record<string, unknown>[],
  employeeId: string,
) {
  const apply = async () => {
    const db = getDb();
    if (db)
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext('crm-reviewed-import'))`,
      );
    const plan = await planCrmImport(kind, rows);
    const result = {
      created: 0,
      skipped: 0,
      errors: [] as { row: number; message: string }[],
    };
    for (const item of plan) {
      if (item.action === "invalid") {
        result.errors.push({ row: item.row, message: item.message });
        continue;
      }
      if (item.action === "existing") {
        result.skipped++;
        continue;
      }
      const insert = async () => {
        if (kind === "companies")
          await createCompany(companySchema.parse(item.values));
        else await createContact(contactSchema.parse(item.values));
      };
      try {
        // A savepoint keeps one bad row from aborting the remaining reviewed rows.
        if (db)
          await db.transaction((tx) =>
            withDatabaseScope(tx as unknown as typeof db, insert),
          );
        else await insert();
        result.created++;
      } catch (error) {
        result.errors.push({
          row: item.row,
          message:
            error instanceof Error
              ? error.message
              : "Record could not be created.",
        });
      }
    }
    await writeAudit({
      actorEmployeeId: employeeId,
      action: `crm.import.${kind}`,
      entityType: kind,
      entityId: null,
      before: null,
      after: {
        created: result.created,
        skipped: result.skipped,
        errorCount: result.errors.length,
      },
      reason: "Reviewed CSV import",
    });
    return result;
  };
  const db = getDb();
  if (db)
    return db.transaction((tx) =>
      withDatabaseScope(tx as unknown as typeof db, apply),
    );
  const previous = memoryImport;
  let release!: () => void;
  memoryImport = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await apply();
  } finally {
    release();
  }
}
