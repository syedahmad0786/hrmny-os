import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { getDb, withDatabaseScope } from "../db";
import { getDemoStore, type DemoClient } from "../demo-store";
import { writeAudit } from "../m1-persistence";
import { createCompany, createDeal, listCompanies } from "../crm/repository";
import { getCrmMemory } from "../crm/memory";
import { workbookClients } from "../crm/workbook";

const gid = z.string().regex(/^\d{6,30}$/);
export const asanaRosterSchema = z.object({
  rows: z
    .array(
      z.object({
        workspaceId: gid,
        projectId: gid,
        projectName: z.string().trim().min(2).max(200),
        clientName: z.string().trim().min(2).max(200),
        observedAt: z
          .string()
          .datetime()
          .refine(
            (value) => Date.parse(value) <= Date.now(),
            "Observation cannot be in the future",
          ),
      }),
    )
    .min(1)
    .max(500),
});
type Source = z.infer<typeof asanaRosterSchema>["rows"][number] & {
  clientId: string;
};
const memorySources = new Map<string, Source>();
const key = (value: string) => value.trim().toLowerCase();
export async function clientSourceProjects(clientId?: string) {
  const db = getDb();
  const rows = db
    ? Array.from(
        await db.execute<Source>(sql`
    select p.project_id as "projectId", p.workspace_id as "workspaceId", p.project_name as "projectName",
      p.client_id as "clientId", c.name as "clientName", p.observed_at::text as "observedAt"
    from public.client_source_project p join public.client c on c.client_id = p.client_id
    ${clientId ? sql`where p.client_id = ${clientId}::uuid` : sql``} order by p.project_name`),
      )
    : [...memorySources.values()].filter(
        (p) =>
          (!clientId || p.clientId === clientId) &&
          getDemoStore().clients.has(p.clientId),
      );
  return rows.map((p) => ({
    ...p,
    url: `https://app.asana.com/1/${p.workspaceId}/project/${p.projectId}`,
  }));
}

export async function planAsanaRoster(
  input: z.infer<typeof asanaRosterSchema>,
) {
  const [companies, clients, sources] = await Promise.all([
    listCompanies(),
    workbookClients(),
    clientSourceProjects(),
  ]);
  const seen = new Set<string>();
  return input.rows.map((row) => {
    const source = sources.find((p) => p.projectId === row.projectId);
    const matched = clients.filter((c) => key(c.name) === key(row.clientName));
    const company = companies.filter(
      (c) => key(c.name) === key(row.clientName),
    );
    const error = seen.has(row.projectId)
      ? "Duplicate project in file."
      : source &&
          (source.workspaceId !== row.workspaceId ||
            key(source.clientName) !== key(row.clientName))
        ? "Project is already linked to a different account."
        : matched.length > 1 || company.length > 1
          ? "Ambiguous account name; resolve duplicates before import."
          : /template|all clients|pipeline|incoming projects|^cluster[- ]|^hrmny\b/i.test(
                row.clientName,
              )
            ? "Internal projects and templates cannot become client accounts."
            : null;
    seen.add(row.projectId);
    return {
      ...row,
      action: error
        ? ("invalid" as const)
        : source
          ? ("existing" as const)
          : matched[0]
            ? ("link" as const)
            : ("create" as const),
      clientId: source?.clientId ?? matched[0]?.id ?? null,
      companyId: company[0]?.companyId ?? null,
      message:
        error ??
        (source
          ? "Already linked; no changes."
          : matched[0]
            ? "Link project to existing client."
            : "Create account; commercial terms stay unrecorded."),
    };
  });
}

let memoryQueue = Promise.resolve();
export async function importAsanaRoster(
  employeeId: string,
  input: z.infer<typeof asanaRosterSchema>,
) {
  const apply = async () => {
    const db = getDb();
    // ponytail: one roster lock for this single-tenant directory; use workspace locks if imports become frequent.
    if (db)
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtext('crm_client_roster'))`,
      );
    const plan = await planAsanaRoster(input);
    if (plan.some((p) => p.action === "invalid"))
      throw new TRPCError({
        code: "CONFLICT",
        message: "Resolve every invalid row before importing.",
      });
    const linkedClients = new Map<string, string>();
    let created = 0,
      linked = 0,
      skipped = 0;
    for (const row of plan) {
      if (row.action === "existing") {
        skipped++;
        continue;
      }
      let clientId = row.clientId ?? linkedClients.get(key(row.clientName));
      if (!clientId) {
        const companyId =
          row.companyId ??
          (await createCompany({ name: row.clientName, market: "UAE" }))
            .companyId;
        let dealId: string;
        // Insert legacy relationships directly: the transition trigger correctly dates new wins on UPDATE.
        if (db) {
          const [deal] = await db.execute<{
            id: string;
          }>(sql`insert into public.deal
            (company_id, company_name, stage, close_outcome, lead_source_lane, closed_at, quote_value)
            values (${companyId}::uuid, ${row.clientName}, 'close', 'won', 'relationship_led', null, null) returning deal_id as id`);
          dealId = deal!.id;
        } else {
          const deal = await createDeal({
            companyId,
            companyName: row.clientName,
            leadSourceLane: "relationship_led",
          });
          dealId = deal.dealId;
          getCrmMemory().deals.set(dealId, {
            ...deal,
            stage: "close",
            closeOutcome: "won",
            closedAt: null,
            quoteValue: null,
          });
        }
        if (db) {
          const result = await db.execute<{
            id: string;
          }>(sql`insert into public.client
            (deal_id, name, market, engagement_type, lifecycle_status)
            values (${dealId}::uuid, ${row.clientName}, 'UAE', 'project', 'active') returning client_id as id`);
          clientId = result[0]!.id;
        } else {
          clientId = randomUUID();
          const client: DemoClient = {
            clientId,
            dealId,
            name: row.clientName,
            market: "UAE",
            engagementType: "project",
            lifecycleStatus: "active",
            contractValue: "",
            currency: "AED",
            startDate: "",
            renewalDate: "",
            fee: "",
            contacts: {},
            approvers: {},
            updatedAt: new Date().toISOString(),
          };
          getDemoStore().clients.set(clientId, client);
        }
        linkedClients.set(key(row.clientName), clientId);
        created++;
      }
      if (db)
        await db.execute(sql`insert into public.client_source_project
        (project_id, workspace_id, client_id, project_name, observed_at, imported_by)
        values (${row.projectId}, ${row.workspaceId}, ${clientId}::uuid, ${row.projectName}, ${row.observedAt}::timestamptz, ${employeeId}::uuid)`);
      else memorySources.set(row.projectId, { ...row, clientId });
      linked++;
    }
    await writeAudit({
      actorEmployeeId: employeeId,
      action: "clients.importAsanaRoster",
      entityType: "client",
      entityId: null,
      before: null,
      after: {
        created,
        linked,
        skipped,
        projects: input.rows.map((r) => r.projectId),
      },
      reason: "Reviewed active Asana client projects",
    });
    return { created, linked, skipped };
  };
  const db = getDb();
  if (db)
    return db.transaction((tx) =>
      withDatabaseScope(tx as unknown as typeof db, apply),
    );
  const result = memoryQueue.then(apply);
  memoryQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
