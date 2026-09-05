import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { getDb, withDatabaseScope } from "../db";
import { DEV_USERS } from "../auth/session";
import { getDemoStore } from "../demo-store";
import { writeAudit } from "../m1-persistence";
import {
  hasSyntheticMarker,
  isSyntheticDeal,
  isSyntheticRecordName,
} from "@/lib/synthetic-records";
import {
  viewConfigSchema,
  type WorkbookConfig,
  type WorkbookRow,
} from "@/lib/crm-workbook";
import {
  listCompanies,
  listContacts,
  listDeals,
  listCrmTasks,
  updateCompany,
  updateContact,
  updateDeal,
  updateCrmTask,
} from "./repository";

export type SavedWorkbookView = {
  id: string;
  ownerId: string;
  name: string;
  visibility: "personal" | "team";
  config: WorkbookConfig;
};
const memoryViews = new Map<string, SavedWorkbookView>();

export async function workbookEmployees() {
  const db = getDb();
  if (!db)
    return Object.values(DEV_USERS)
      .filter((u) => u.actorType === "staff")
      .map((u) => ({ id: u.employeeId, name: u.displayName }));
  return Array.from(
    await db.execute<{ id: string; name: string }>(
      sql`select employee_id as id, display_name as name from public.employee where is_active = true order by display_name`,
    ),
  );
}

export async function workbookClients() {
  const db = getDb();
  if (!db)
    return [...getDemoStore().clients.values()].map((c) => ({
      id: c.clientId,
      dealId: c.dealId,
      name: c.name,
      status: c.lifecycleStatus,
      market: c.market,
      value: String(c.contractValue ?? ""),
      currency: c.currency ?? "AED",
      renewal: c.renewalDate ?? "",
      ownerId: c.ownerEmployeeId ?? null,
      updatedAt: c.updatedAt ?? "",
    }));
  return Array.from(
    await db.execute<{
      id: string;
      dealId: string;
      name: string;
      status: string;
      market: string;
      value: string;
      currency: string;
      renewal: string;
      ownerId: string | null;
      updatedAt: string;
    }>(sql`
    select c.client_id as id, c.deal_id as "dealId", c.name, c.lifecycle_status::text as status,
      c.market::text as market, coalesce(c.contract_value::text, '') as value, c.currency,
      coalesce(c.renewal_date::text, '') as renewal, c.updated_at::text as "updatedAt",
      (select employee_id from public.account_team_member m where m.client_id = c.client_id and m.is_account_lead order by m.created_at limit 1) as "ownerId"
    from public.client c order by c.name`),
  );
}

export async function workbookSnapshot() {
  const [companies, contacts, deals, tasks, clients, employees] =
    await Promise.all([
      listCompanies(),
      listContacts(),
      listDeals(),
      listCrmTasks(),
      workbookClients(),
      workbookEmployees(),
    ]);
  const people = new Map(employees.map((e) => [e.id, e.name]));
  const co = new Map(companies.map((c) => [c.companyId, c]));
  const de = new Map(deals.map((d) => [d.dealId, d]));
  const ct = new Map(contacts.map((c) => [c.contactId, c]));
  const nextTask = (id: string, companyId?: string | null) =>
    tasks
      .filter(
        (t) =>
          (t.dealId === id ||
            (companyId && t.companyId === companyId && !t.dealId)) &&
          !["done", "cancelled"].includes(t.status),
      )
      .sort((a, b) =>
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
      )[0];
  const base = (
    kind: WorkbookRow["kind"],
    id: string,
    name: string,
    ownerId?: string | null,
  ): WorkbookRow => ({
    kind,
    id,
    name,
    ownerId: ownerId ?? null,
    owner: ownerId
      ? (people.get(ownerId) ?? "Inactive employee")
      : "Unassigned",
    href:
      kind === "clients"
        ? `/clients/${id}`
        : kind === "followups"
          ? `/crm/followups?record=${id}`
          : `/crm/${kind}/${id}`,
    company: "",
    status: "",
    stage: "",
    source: "",
    market: "",
    sector: "",
    email: "",
    phone: "",
    title: "",
    website: "",
    linkedin: "",
    verified: "",
    value: "",
    currency: "",
    expectedClose: "",
    nextAction: "",
    due: "",
    lastInteraction: "",
    renewal: "",
    updatedAt: "",
    test: false,
    issues: [],
  });
  const rows: WorkbookRow[] = [];
  for (const c of companies) {
    const linked = deals.filter(
      (d) => d.companyId === c.companyId && !isSyntheticDeal(d),
    );
    rows.push({
      ...base("companies", c.companyId, c.name, c.ownerEmployeeId),
      company: c.name,
      market: c.market ?? "",
      sector: c.sector ?? "",
      website: c.website ?? "",
      linkedin: c.linkedinUrl ?? "",
      updatedAt: c.updatedAt,
      status: linked.some((d) => d.closeOutcome === "won")
        ? "Customer"
        : linked.some((d) => !d.closeOutcome)
          ? "In pipeline"
          : "Prospect",
      test: isSyntheticRecordName(c.name),
      issues: !c.website ? ["Missing company website"] : [],
    });
  }
  for (const c of contacts) {
    const company = c.companyId ? co.get(c.companyId) : null;
    const issues = [];
    if (!company) issues.push("Missing company link");
    if (!c.email && c.firstName.includes("@"))
      issues.push("Email stored in name; review contact fields");
    if (!c.email) issues.push("Missing work email");
    rows.push({
      ...base(
        "contacts",
        c.contactId,
        `${c.firstName} ${c.lastName ?? ""}`.trim(),
        c.ownerEmployeeId ?? company?.ownerEmployeeId,
      ),
      company: company?.name ?? "",
      title: c.title ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      linkedin: c.linkedinUrl ?? "",
      verified: c.email && c.emailVerified ? "Verified" : "Needs verification",
      lastInteraction: c.lastInteractionAt ?? "",
      updatedAt: c.updatedAt,
      status: c.email && c.emailVerified ? "Verified" : "Needs verification",
      test: hasSyntheticMarker(c.firstName, c.lastName, c.email, company?.name),
      issues,
    });
  }
  for (const d of deals) {
    const company = d.companyId ? co.get(d.companyId) : null;
    const contact = d.primaryContactId ? ct.get(d.primaryContactId) : null;
    const task = nextTask(d.dealId, d.companyId);
    rows.push({
      ...base(
        "deals",
        d.dealId,
        d.opportunityName || d.companyName,
        d.ownerEmployeeId,
      ),
      company: company?.name ?? d.companyName,
      status:
        d.closeOutcome === "won"
          ? "Won"
          : d.closeOutcome === "lost"
            ? "Lost"
            : d.closeOutcome
              ? "On hold"
              : "Open",
      stage: d.stage,
      source: d.leadSourceLane,
      market: company?.market ?? "",
      sector: d.sector ?? company?.sector ?? "",
      value: d.quoteValue ?? "",
      currency: "AED",
      expectedClose: d.expectedCloseDate ?? "",
      email: contact?.email ?? "",
      verified:
        contact?.email && contact.emailVerified
          ? "Verified"
          : "Needs verification",
      nextAction: task?.title ?? "",
      due: task?.dueDate ?? "",
      updatedAt: d.updatedAt,
      test: isSyntheticDeal(d),
      issues: [],
    });
  }
  for (const c of clients) {
    const d = de.get(c.dealId);
    const company = d?.companyId ? co.get(d.companyId) : null;
    const task = nextTask(c.dealId, d?.companyId);
    rows.push({
      ...base("clients", c.id, c.name, c.ownerId),
      company: company?.name ?? d?.companyName ?? c.name,
      market: c.market,
      status: c.status,
      value: c.value,
      currency: c.currency,
      renewal: c.renewal,
      nextAction: task?.title ?? "",
      due: task?.dueDate ?? "",
      updatedAt: c.updatedAt,
      test: isSyntheticRecordName(c.name) || Boolean(d && isSyntheticDeal(d)),
      issues: !d?.companyId ? ["Link the originating deal to its company"] : [],
    });
  }
  for (const t of tasks) {
    const d = t.dealId ? de.get(t.dealId) : null;
    const company = t.companyId
      ? co.get(t.companyId)
      : d?.companyId
        ? co.get(d.companyId)
        : null;
    rows.push({
      ...base("followups", t.crmTaskId, t.title, t.ownerEmployeeId),
      company: company?.name ?? d?.companyName ?? "",
      status: t.status,
      due: t.dueDate ?? "",
      updatedAt: t.updatedAt,
      test:
        hasSyntheticMarker(t.title, company?.name) ||
        Boolean(d && isSyntheticDeal(d)),
      issues:
        !t.dueDate && !["done", "cancelled"].includes(t.status)
          ? ["Missing follow-up date"]
          : [],
    });
  }
  return { rows, employees };
}

export async function savedWorkbookViews(employeeId: string) {
  const db = getDb();
  if (!db)
    return [...memoryViews.values()].filter(
      (v) => v.ownerId === employeeId || v.visibility === "team",
    );
  const rows = await db.execute<
    Omit<SavedWorkbookView, "config"> & { config: unknown }
  >(sql`
    select view_id as id, owner_employee_id as "ownerId", name, visibility, config from public.crm_saved_view
    where owner_employee_id = ${employeeId}::uuid or visibility = 'team' order by name`);
  return Array.from(rows).flatMap((row) => {
    const config = viewConfigSchema.safeParse(row.config);
    return config.success ? [{ ...row, config: config.data }] : [];
  });
}

export async function saveWorkbookView(
  employeeId: string,
  input: Omit<SavedWorkbookView, "id" | "ownerId"> & { id?: string },
) {
  const row = { ...input, id: input.id ?? randomUUID(), ownerId: employeeId };
  const db = getDb();
  if (db) {
    const saved =
      await db.execute(sql`insert into public.crm_saved_view (view_id, owner_employee_id, name, visibility, config)
      values (${row.id}::uuid, ${employeeId}::uuid, ${row.name}, ${row.visibility}, ${JSON.stringify(row.config)}::jsonb)
      on conflict (view_id) do update set name = excluded.name, visibility = excluded.visibility, config = excluded.config, updated_at = now()
      where crm_saved_view.owner_employee_id = ${employeeId}::uuid returning view_id`);
    if (!saved.length)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the view owner can change this view.",
      });
  } else {
    const prior = memoryViews.get(row.id);
    if (prior && prior.ownerId !== employeeId)
      throw new TRPCError({ code: "FORBIDDEN" });
    memoryViews.set(row.id, row);
  }
  await writeAudit({
    actorEmployeeId: employeeId,
    action: "crm.workbook.saveView",
    entityType: "crm_saved_view",
    entityId: row.id,
    before: null,
    after: { name: row.name, visibility: row.visibility },
    reason: null,
  });
  return row;
}

export async function deleteWorkbookView(employeeId: string, id: string) {
  const db = getDb();
  if (db) {
    const rows = await db.execute(
      sql`delete from public.crm_saved_view where view_id = ${id}::uuid and owner_employee_id = ${employeeId}::uuid returning view_id`,
    );
    if (!rows.length) throw new TRPCError({ code: "NOT_FOUND" });
  } else {
    if (memoryViews.get(id)?.ownerId !== employeeId)
      throw new TRPCError({ code: "NOT_FOUND" });
    memoryViews.delete(id);
  }
  return { ok: true };
}

export type WorkbookEdit = {
  kind: WorkbookRow["kind"];
  records: { id: string; updatedAt: string }[];
  field: "ownerId" | "title" | "due" | "status" | "renewal";
  value: string | null;
};
export async function editWorkbook(employeeId: string, input: WorkbookEdit) {
  const apply = async () => {
    const db = getDb();
    // Lock the selected records before re-reading to detect stale edits and keep a bulk change atomic.
    if (db) {
      const table = {
        companies: "company",
        contacts: "contact",
        deals: "deal",
        clients: "client",
        followups: "crm_task",
      }[input.kind];
      const key = {
        companies: "company_id",
        contacts: "contact_id",
        deals: "deal_id",
        clients: "client_id",
        followups: "crm_task_id",
      }[input.kind];
      const ids = sql.join(
        input.records.map((r) => sql`${r.id}::uuid`),
        sql`, `,
      );
      await db.execute(
        sql`select ${sql.identifier(key)} from ${sql.identifier(table)} where ${sql.identifier(key)} in (${ids}) order by ${sql.identifier(key)} for update`,
      );
    }
    const snapshot = await workbookSnapshot();
    if (
      input.field === "ownerId" &&
      input.value &&
      !snapshot.employees.some((e) => e.id === input.value)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select an active employee.",
      });
    const before = input.records.map((record) => {
      const row = snapshot.rows.find(
        (r) => r.kind === input.kind && r.id === record.id,
      );
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "A selected record no longer exists.",
        });
      if (row.updatedAt !== record.updatedAt)
        throw new TRPCError({
          code: "CONFLICT",
          message: "A selected record changed. Refresh and review it again.",
        });
      return row;
    });
    for (const row of before) {
      if (input.field === "ownerId") {
        if (input.kind === "companies")
          await updateCompany(row.id, { ownerEmployeeId: input.value });
        if (input.kind === "contacts")
          await updateContact(row.id, { ownerEmployeeId: input.value });
        if (input.kind === "deals")
          await updateDeal(row.id, { ownerEmployeeId: input.value });
        if (input.kind === "followups")
          await updateCrmTask(row.id, { ownerEmployeeId: input.value });
      } else if (input.kind === "followups") {
        await updateCrmTask(
          row.id,
          input.field === "title"
            ? { title: input.value! }
            : input.field === "due"
              ? { dueDate: input.value }
              : {
                  status: input.value as
                    "open" | "in_progress" | "done" | "cancelled",
                },
        );
      }
      if (input.kind === "clients") {
        if (db) {
          if (input.field === "ownerId") {
            await db.execute(
              sql`update public.account_team_member set is_account_lead = false where client_id = ${row.id}::uuid`,
            );
            if (input.value)
              await db.execute(
                sql`insert into public.account_team_member (client_id, employee_id, account_role, is_account_lead) values (${row.id}::uuid, ${input.value}::uuid, 'Account lead', true) on conflict (client_id, employee_id) do update set is_account_lead = true`,
              );
            await db.execute(
              sql`update public.client set updated_at = now() where client_id = ${row.id}::uuid`,
            );
          } else if (input.field === "renewal")
            await db.execute(
              sql`update public.client set renewal_date = ${input.value}::date, updated_at = now() where client_id = ${row.id}::uuid`,
            );
          else
            await db.execute(
              sql`update public.client set lifecycle_status = ${input.value}::client_lifecycle_enum, updated_at = now() where client_id = ${row.id}::uuid`,
            );
        } else {
          const client = getDemoStore().clients.get(row.id)!;
          if (input.field === "ownerId") client.ownerEmployeeId = input.value;
          client.updatedAt = new Date().toISOString();
          if (input.field === "renewal") client.renewalDate = input.value ?? "";
          if (input.field === "status")
            client.lifecycleStatus =
              input.value as typeof client.lifecycleStatus;
        }
      }
      await writeAudit({
        actorEmployeeId: employeeId,
        action: "crm.workbook.edit",
        entityType: input.kind,
        entityId: row.id,
        before: {
          [input.field]: row[input.field === "title" ? "name" : input.field],
        },
        after: { [input.field]: input.value },
        reason: "Reviewed workbook edit",
      });
    }
    return { updated: before.length };
  };
  const db = getDb();
  return db
    ? db.transaction((tx) =>
        withDatabaseScope(tx as unknown as typeof db, apply),
      )
    : apply();
}
