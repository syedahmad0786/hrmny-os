import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  canTransitionServiceRequest,
  canTransitionWorkflowStep,
  isWorkplaceAdmin,
} from "../workplace";
import { getDb } from "../db";
import {
  GBRAIN_SHARE_CONFIRMATION,
  GBRAIN_UPSTREAM_REVISION,
  GBRAIN_UPSTREAM_VERSION,
  GbrainError,
  gbrainConfigured,
  projectKnowledgeArticle,
  publishKnowledgeToGbrain,
  type PublishedKnowledgeArticle,
} from "../gbrain";
import { getIntegrationReceipt } from "../integrations/inbox";
import { writeAudit } from "../m1-persistence";
import { router, staffProcedure, type TrpcContext } from "./trpc";

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for Workplace",
    });
  }
  return db;
}

function actor(ctx: TrpcContext) {
  if (!ctx.user || !ctx.employeeId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return { employeeId: ctx.employeeId, roles: ctx.roles };
}

function requireAdmin(ctx: TrpcContext) {
  if (!isWorkplaceAdmin(ctx.roles)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "HR access required" });
  }
  return actor(ctx);
}

async function audit(
  ctx: TrpcContext,
  action: string,
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
) {
  await writeAudit({
    actorEmployeeId: actor(ctx).employeeId,
    action,
    entityType,
    entityId,
    before: null,
    after,
    reason: null,
  });
}

const uuid = z.string().uuid();
const jsonObject = z.record(z.unknown());
const workflowStepSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/i),
  title: z.string().trim().min(2).max(160),
  assigneeRole: z.string().trim().min(1).max(80).optional(),
  dueOffsetDays: z.number().int().min(-365).max(365).optional(),
});
const workflowStepsSchema = z.array(workflowStepSchema).min(1).max(30);
const requestStatus = z.enum([
  "new",
  "triaged",
  "open",
  "pending_requester",
  "pending_internal",
  "resolved",
  "closed",
]);

async function publishedKnowledgeArticle(
  articleId: string,
): Promise<PublishedKnowledgeArticle> {
  const rows = await requireDb().execute<PublishedKnowledgeArticle>(sql`
    select
      a.knowledge_article_id::text as "articleId",
      a.slug,
      a.title,
      a.category,
      a.current_version::integer as version,
      v.body
    from public.knowledge_article a
    join public.knowledge_article_version v
      on v.knowledge_article_id = a.knowledge_article_id
     and v.version_number = a.current_version
    where a.knowledge_article_id = ${articleId}::uuid
      and a.status = 'published'
      and a.published_at <= now()
    limit 1
  `);
  if (!rows[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Publish this knowledge article before sharing it",
    });
  }
  return rows[0];
}

function gbrainFailure(error: unknown): never {
  if (!(error instanceof GbrainError)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Company brain share could not be recorded",
    });
  }
  if (error.code === "GBRAIN_NOT_CONFIGURED") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Company brain setup is required in Connections",
    });
  }
  if (error.code === "GBRAIN_OPERATION_IN_PROGRESS") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This exact article version is already being shared",
    });
  }
  if (error.code === "GBRAIN_MANUAL_RECONCILIATION_REQUIRED") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Company brain needs manual receipt reconciliation before retry",
    });
  }
  throw new TRPCError({
    code: "BAD_GATEWAY",
    message: `Company brain did not verify the share (${error.code})`,
  });
}

export const workplaceRouter = router({
  announcements: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isWorkplaceAdmin(current.roles)
        ? sql`true`
        : sql`a.status = 'published' and a.published_at <= now() and a.audience = 'all'`;
      return requireDb().execute(sql`
        select a.*,
          exists (
            select 1
            from public.workplace_announcement_acknowledgement ack
            where ack.workplace_announcement_id = a.workplace_announcement_id
              and ack.employee_id = ${current.employeeId}::uuid
          ) as acknowledged
        from public.workplace_announcement a
        where ${access}
        order by a.published_at desc nulls last, a.created_at desc
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          title: z.string().trim().min(2).max(200),
          body: z.string().trim().min(1).max(50_000),
          audience: z.literal("all").default("all"),
          requiresAcknowledgement: z.boolean().default(false),
          publish: z.boolean().default(false),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.workplace_announcement (
            title, body, audience, status, requires_acknowledgement,
            published_at, created_by_employee_id
          ) values (
            ${input.title}, ${input.body}, ${input.audience},
            ${input.publish ? "published" : "draft"},
            ${input.requiresAcknowledgement},
            ${input.publish ? new Date() : null}::timestamptz,
            ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "workplace.announcement.create",
          "workplace_announcement",
          String(created.workplace_announcement_id),
          { publish: input.publish },
        );
        return created;
      }),

    setStatus: staffProcedure
      .input(
        z.object({
          announcementId: uuid,
          status: z.enum(["published", "archived"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          update public.workplace_announcement
          set status = ${input.status},
              published_at = case
                when ${input.status} = 'published' then coalesce(published_at, now())
                else published_at
              end,
              updated_at = now()
          where workplace_announcement_id = ${input.announcementId}::uuid
          returning *
        `);
        const updated = rows[0];
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "workplace.announcement.status",
          "workplace_announcement",
          input.announcementId,
          { status: input.status },
        );
        return updated;
      }),

    acknowledge: staffProcedure
      .input(z.object({ announcementId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.workplace_announcement_acknowledgement (
            workplace_announcement_id, employee_id
          )
          select workplace_announcement_id, ${current.employeeId}::uuid
          from public.workplace_announcement
          where workplace_announcement_id = ${input.announcementId}::uuid
            and status = 'published'
            and published_at <= now()
            and audience = 'all'
            and requires_acknowledgement = true
          on conflict (workplace_announcement_id, employee_id)
          do update set acknowledged_at = excluded.acknowledged_at
          returning *
        `);
        const acknowledgement = rows[0];
        if (!acknowledgement) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "workplace.announcement.acknowledge",
          "workplace_announcement",
          input.announcementId,
          { employeeId: current.employeeId },
        );
        return acknowledgement;
      }),
  }),

  knowledge: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isWorkplaceAdmin(current.roles)
        ? sql`true`
        : sql`a.status = 'published' and a.published_at <= now()`;
      return requireDb().execute(sql`
        select a.*,
          exists (
            select 1
            from public.knowledge_article_acknowledgement ack
            where ack.knowledge_article_id = a.knowledge_article_id
              and ack.version_number = a.current_version
              and ack.employee_id = ${current.employeeId}::uuid
          ) as acknowledged
        from public.knowledge_article a
        where ${access}
        order by a.category, a.title
      `);
    }),

    get: staffProcedure
      .input(z.object({ articleId: uuid }))
      .query(async ({ input, ctx }) => {
        const current = actor(ctx);
        const access = isWorkplaceAdmin(current.roles)
          ? sql`true`
          : sql`a.status = 'published' and a.published_at <= now()`;
        const rows = await requireDb().execute(sql`
          select a.*, v.body, v.change_note, v.created_at as version_created_at,
            exists (
              select 1
              from public.knowledge_article_acknowledgement ack
              where ack.knowledge_article_id = a.knowledge_article_id
                and ack.version_number = a.current_version
                and ack.employee_id = ${current.employeeId}::uuid
            ) as acknowledged
          from public.knowledge_article a
          join public.knowledge_article_version v
            on v.knowledge_article_id = a.knowledge_article_id
           and v.version_number = a.current_version
          where a.knowledge_article_id = ${input.articleId}::uuid
            and ${access}
          limit 1
        `);
        return rows[0] ?? null;
      }),

    brainPreview: staffProcedure
      .input(z.object({ articleId: uuid }))
      .query(async ({ input, ctx }) => {
        requireAdmin(ctx);
        const article = await publishedKnowledgeArticle(input.articleId);
        const projection = projectKnowledgeArticle(article);
        const eventId = `knowledge:${article.articleId}:v${article.version}:project`;
        const receipt = await getIntegrationReceipt("gbrain", eventId);
        const result = receipt?.result as Record<string, unknown> | null;
        return {
          configured: gbrainConfigured(),
          upstreamVersion: GBRAIN_UPSTREAM_VERSION,
          upstreamRevision: GBRAIN_UPSTREAM_REVISION,
          articleId: article.articleId,
          title: article.title,
          category: article.category,
          body: article.body,
          version: article.version,
          slug: projection.gbrainSlug,
          contentHash: projection.contentHash,
          bytes: projection.bytes,
          receiptId: receipt?.receiptId ?? null,
          receiptStatus: receipt?.status ?? "not_shared",
          bridgeStatus:
            typeof result?.bridgeStatus === "string"
              ? result.bridgeStatus
              : "not_shared",
          shared:
            receipt?.status === "completed" &&
            result?.bridgeStatus === "verified" &&
            result.contentHash === projection.contentHash,
        };
      }),

    shareWithBrain: staffProcedure
      .input(
        z.object({
          articleId: uuid,
          expectedVersion: z.number().int().positive(),
          expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
          confirmation: z.literal(GBRAIN_SHARE_CONFIRMATION),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const article = await publishedKnowledgeArticle(input.articleId);
        const projection = projectKnowledgeArticle(article);
        if (
          article.version !== input.expectedVersion ||
          projection.contentHash !== input.expectedContentHash
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "The article changed after review; review it again",
          });
        }
        try {
          const shared = await publishKnowledgeToGbrain(
            article,
            current.employeeId,
          );
          await audit(
            ctx,
            "workplace.knowledge.gbrain.share",
            "knowledge_article",
            article.articleId,
            {
              version: article.version,
              contentHash: projection.contentHash,
              slug: projection.gbrainSlug,
              receiptId: shared.receiptId,
              replay: shared.replay,
            },
          );
          return {
            articleId: article.articleId,
            version: article.version,
            slug: projection.gbrainSlug,
            contentHash: projection.contentHash,
            receiptId: shared.receiptId,
            replay: shared.replay,
            verified: true,
          };
        } catch (error) {
          gbrainFailure(error);
        }
      }),

    create: staffProcedure
      .input(
        z.object({
          slug: z
            .string()
            .trim()
            .min(2)
            .max(160)
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          title: z.string().trim().min(2).max(200),
          category: z.string().trim().min(2).max(100).default("general"),
          body: z.string().trim().min(1).max(100_000),
          publish: z.boolean().default(false),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const created = await requireDb().transaction(async (tx) => {
          const rows = await tx.execute(sql`
            insert into public.knowledge_article (
              slug, title, category, status, current_version,
              created_by_employee_id, published_at
            ) values (
              ${input.slug}, ${input.title}, ${input.category},
              ${input.publish ? "published" : "draft"}, 1,
              ${current.employeeId}::uuid,
              ${input.publish ? new Date() : null}::timestamptz
            )
            returning *
          `);
          const article = rows[0]!;
          await tx.execute(sql`
            insert into public.knowledge_article_version (
              knowledge_article_id, version_number, body, created_by_employee_id
            ) values (
              ${String(article.knowledge_article_id)}::uuid, 1, ${input.body},
              ${current.employeeId}::uuid
            )
          `);
          return article;
        });
        await audit(
          ctx,
          "workplace.knowledge.create",
          "knowledge_article",
          String(created.knowledge_article_id),
          { publish: input.publish, version: 1 },
        );
        return created;
      }),

    addVersion: staffProcedure
      .input(
        z.object({
          articleId: uuid,
          title: z.string().trim().min(2).max(200).optional(),
          body: z.string().trim().min(1).max(100_000),
          changeNote: z.string().trim().max(1_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const updated = await requireDb().transaction(async (tx) => {
          const articles = await tx.execute(sql<{ current_version: number }>`
            select current_version
            from public.knowledge_article
            where knowledge_article_id = ${input.articleId}::uuid
            for update
          `);
          const article = articles[0];
          if (!article) throw new TRPCError({ code: "NOT_FOUND" });
          const version = Number(article.current_version) + 1;
          await tx.execute(sql`
            insert into public.knowledge_article_version (
              knowledge_article_id, version_number, body, change_note,
              created_by_employee_id
            ) values (
              ${input.articleId}::uuid, ${version}, ${input.body},
              ${input.changeNote ?? null}, ${current.employeeId}::uuid
            )
          `);
          const rows = await tx.execute(sql`
            update public.knowledge_article
            set current_version = ${version},
                title = coalesce(${input.title ?? null}, title),
                status = 'draft', published_at = null, updated_at = now()
            where knowledge_article_id = ${input.articleId}::uuid
            returning *
          `);
          return rows[0]!;
        });
        await audit(
          ctx,
          "workplace.knowledge.version",
          "knowledge_article",
          input.articleId,
          { version: Number(updated.current_version) },
        );
        return updated;
      }),

    publish: staffProcedure
      .input(z.object({ articleId: uuid }))
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          update public.knowledge_article
          set status = 'published', published_at = now(), updated_at = now()
          where knowledge_article_id = ${input.articleId}::uuid
          returning *
        `);
        const updated = rows[0];
        if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "workplace.knowledge.publish",
          "knowledge_article",
          input.articleId,
          { version: Number(updated.current_version) },
        );
        return updated;
      }),

    acknowledge: staffProcedure
      .input(z.object({ articleId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.knowledge_article_acknowledgement (
            knowledge_article_id, version_number, employee_id
          )
          select knowledge_article_id, current_version, ${current.employeeId}::uuid
          from public.knowledge_article
          where knowledge_article_id = ${input.articleId}::uuid
            and status = 'published' and published_at <= now()
          on conflict (knowledge_article_id, version_number, employee_id)
          do update set acknowledged_at = excluded.acknowledged_at
          returning *
        `);
        const acknowledgement = rows[0];
        if (!acknowledgement) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "workplace.knowledge.acknowledge",
          "knowledge_article",
          input.articleId,
          { employeeId: current.employeeId },
        );
        return acknowledgement;
      }),
  }),

  workflows: router({
    definitions: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isWorkplaceAdmin(current.roles)
        ? sql`true`
        : sql`is_active = true`;
      return requireDb().execute(sql`
        select * from public.workflow_definition
        where ${access}
        order by name
      `);
    }),

    createDefinition: staffProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          description: z.string().trim().max(2_000).optional(),
          triggerKey: z.string().trim().min(2).max(80).default("manual"),
          steps: workflowStepsSchema,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const keys = new Set(input.steps.map((step) => step.key));
        if (keys.size !== input.steps.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Duplicate step key",
          });
        }
        const rows = await requireDb().execute(sql`
          insert into public.workflow_definition (
            name, description, trigger_key, steps, created_by_employee_id
          ) values (
            ${input.name}, ${input.description ?? null}, ${input.triggerKey},
            ${JSON.stringify(input.steps)}::jsonb, ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "workplace.workflow.definition.create",
          "workflow_definition",
          String(created.workflow_definition_id),
          { stepCount: input.steps.length },
        );
        return created;
      }),

    runs: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isWorkplaceAdmin(current.roles)
        ? sql`true`
        : sql`(
            r.subject_employee_id = ${current.employeeId}::uuid
            or r.requested_by_employee_id = ${current.employeeId}::uuid
          )`;
      return requireDb().execute(sql`
        select r.*, d.name as workflow_name,
          (select count(*)::integer from public.workflow_run_step s
            where s.workflow_run_id = r.workflow_run_id) as step_count,
          (select count(*)::integer from public.workflow_run_step s
            where s.workflow_run_id = r.workflow_run_id
              and s.status in ('completed', 'skipped')) as completed_step_count
        from public.workflow_run r
        join public.workflow_definition d
          on d.workflow_definition_id = r.workflow_definition_id
        where ${access}
        order by r.created_at desc
      `);
    }),

    start: staffProcedure
      .input(
        z.object({
          definitionId: uuid,
          subjectEmployeeId: uuid.optional(),
          context: jsonObject.default({}),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const run = await requireDb().transaction(async (tx) => {
          const definitions = await tx.execute(sql<{ steps: unknown }>`
            select steps
            from public.workflow_definition
            where workflow_definition_id = ${input.definitionId}::uuid
              and is_active = true
            limit 1
          `);
          if (!definitions[0]) throw new TRPCError({ code: "NOT_FOUND" });
          const steps = workflowStepsSchema.parse(definitions[0].steps);
          const rows = await tx.execute(sql`
            insert into public.workflow_run (
              workflow_definition_id, subject_employee_id,
              requested_by_employee_id, status, context, started_at
            ) values (
              ${input.definitionId}::uuid,
              ${input.subjectEmployeeId ?? null}::uuid,
              ${current.employeeId}::uuid, 'running',
              ${JSON.stringify(input.context)}::jsonb, now()
            )
            returning *
          `);
          const created = rows[0]!;
          await tx.execute(sql`
            insert into public.workflow_run_step (
              workflow_run_id, step_order, step_key, title, assignee_role, due_at
            )
            select
              ${String(created.workflow_run_id)}::uuid,
              item.ordinality::integer,
              item.value->>'key',
              item.value->>'title',
              item.value->>'assigneeRole',
              case
                when item.value ? 'dueOffsetDays'
                  then now() + make_interval(days => (item.value->>'dueOffsetDays')::integer)
                else null
              end
            from jsonb_array_elements(${JSON.stringify(steps)}::jsonb)
              with ordinality as item(value, ordinality)
          `);
          return created;
        });
        await audit(
          ctx,
          "workplace.workflow.run.start",
          "workflow_run",
          String(run.workflow_run_id),
          {
            definitionId: input.definitionId,
            subjectEmployeeId: input.subjectEmployeeId ?? null,
          },
        );
        return run;
      }),

    steps: staffProcedure
      .input(z.object({ runId: uuid }))
      .query(async ({ input, ctx }) => {
        const current = actor(ctx);
        const access = isWorkplaceAdmin(current.roles)
          ? sql`true`
          : sql`(
              r.subject_employee_id = ${current.employeeId}::uuid
              or r.requested_by_employee_id = ${current.employeeId}::uuid
            )`;
        return requireDb().execute(sql`
          select s.*
          from public.workflow_run_step s
          join public.workflow_run r on r.workflow_run_id = s.workflow_run_id
          where s.workflow_run_id = ${input.runId}::uuid and ${access}
          order by s.step_order
        `);
      }),

    updateStep: staffProcedure
      .input(
        z.object({
          stepId: uuid,
          status: z.enum(["in_progress", "completed", "skipped", "failed"]),
          result: jsonObject.default({}),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const updated = await requireDb().transaction(async (tx) => {
          const existingRows = await tx.execute<{
            status: string;
            workflow_run_id: string;
          }>(sql`
            select status, workflow_run_id
            from public.workflow_run_step
            where workflow_run_step_id = ${input.stepId}::uuid
            for update
          `);
          const existing = existingRows[0];
          if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
          if (!canTransitionWorkflowStep(existing.status, input.status)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Invalid step transition",
            });
          }
          const rows = await tx.execute(sql`
            update public.workflow_run_step
            set status = ${input.status}, result = ${JSON.stringify(input.result)}::jsonb,
                completed_by_employee_id = case
                  when ${input.status} in ('completed', 'skipped', 'failed')
                    then ${current.employeeId}::uuid else null
                end,
                completed_at = case
                  when ${input.status} in ('completed', 'skipped', 'failed')
                    then now() else null
                end,
                updated_at = now()
            where workflow_run_step_id = ${input.stepId}::uuid
            returning *
          `);
          await tx.execute(sql`
            update public.workflow_run r
            set status = case
                  when exists (
                    select 1 from public.workflow_run_step s
                    where s.workflow_run_id = r.workflow_run_id and s.status = 'failed'
                  ) then 'failed'
                  when not exists (
                    select 1 from public.workflow_run_step s
                    where s.workflow_run_id = r.workflow_run_id
                      and s.status in ('pending', 'in_progress')
                  ) then 'completed'
                  else 'running'
                end,
                completed_at = case
                  when exists (
                    select 1 from public.workflow_run_step s
                    where s.workflow_run_id = r.workflow_run_id and s.status = 'failed'
                  ) or not exists (
                    select 1 from public.workflow_run_step s
                    where s.workflow_run_id = r.workflow_run_id
                      and s.status in ('pending', 'in_progress')
                  ) then now() else null
                end,
                updated_at = now()
            where r.workflow_run_id = ${existing.workflow_run_id}::uuid
          `);
          return rows[0]!;
        });
        await audit(
          ctx,
          "workplace.workflow.step.update",
          "workflow_run_step",
          input.stepId,
          { status: input.status },
        );
        return updated;
      }),
  }),

  serviceRequests: router({
    types: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isWorkplaceAdmin(current.roles)
        ? sql`true`
        : sql`is_active = true`;
      return requireDb().execute(sql`
        select * from public.service_request_type
        where ${access}
        order by category, name
      `);
    }),

    createType: staffProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          category: z.string().trim().min(2).max(100).default("general"),
          description: z.string().trim().max(2_000).optional(),
          responseSlaHours: z.number().int().min(1).max(8_760).optional(),
          formSchema: jsonObject.default({}),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.service_request_type (
            name, category, description, response_sla_hours,
            form_schema, created_by_employee_id
          ) values (
            ${input.name}, ${input.category}, ${input.description ?? null},
            ${input.responseSlaHours ?? null},
            ${JSON.stringify(input.formSchema)}::jsonb,
            ${current.employeeId}::uuid
          )
          returning *
        `);
        const created = rows[0]!;
        await audit(
          ctx,
          "workplace.serviceRequest.type.create",
          "service_request_type",
          String(created.service_request_type_id),
          { category: input.category },
        );
        return created;
      }),

    list: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const access = isWorkplaceAdmin(current.roles)
        ? sql`true`
        : sql`t.requester_employee_id = ${current.employeeId}::uuid`;
      return requireDb().execute(sql`
        select t.*, rt.name as request_type_name, rt.category,
          rt.response_sla_hours
        from public.ticket t
        join public.service_request_type rt
          on rt.service_request_type_id = t.service_request_type_id
        where t.requester_type = 'employee' and ${access}
        order by t.updated_at desc
      `);
    }),

    create: staffProcedure
      .input(
        z.object({
          requestTypeId: uuid,
          subject: z.string().trim().min(2).max(200),
          body: z.string().trim().max(10_000).optional(),
          priority: z
            .enum(["low", "medium", "high", "urgent"])
            .default("medium"),
          submittedForm: jsonObject.default({}),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        const rows = await requireDb().execute(sql`
          insert into public.ticket (
            subject, body, status, priority, requester_type,
            requester_employee_id, service_request_type_id,
            submitted_form, metadata
          )
          select
            ${input.subject}, ${input.body ?? null}, 'new', ${input.priority},
            'employee', ${current.employeeId}::uuid, service_request_type_id,
            ${JSON.stringify(input.submittedForm)}::jsonb,
            '{"source":"workplace"}'::jsonb
          from public.service_request_type
          where service_request_type_id = ${input.requestTypeId}::uuid
            and is_active = true
          returning *
        `);
        const created = rows[0];
        if (!created) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "workplace.serviceRequest.create",
          "ticket",
          String(created.ticket_id),
          { requestTypeId: input.requestTypeId, priority: input.priority },
        );
        return created;
      }),

    updateStatus: staffProcedure
      .input(
        z.object({
          requestId: uuid,
          status: requestStatus.exclude(["new"]),
          assigneeEmployeeId: uuid.optional(),
          note: z.string().trim().min(1).max(5_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = requireAdmin(ctx);
        const updated = await requireDb().transaction(async (tx) => {
          const existingRows = await tx.execute<{
            status: string;
            service_request_type_id: string | null;
          }>(sql`
            select status, service_request_type_id
            from public.ticket
            where ticket_id = ${input.requestId}::uuid
            for update
          `);
          const existing = existingRows[0];
          if (!existing?.service_request_type_id) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }
          if (!canTransitionServiceRequest(existing.status, input.status)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Invalid request transition",
            });
          }
          const rows = await tx.execute(sql`
            update public.ticket
            set status = ${input.status},
                assignee_employee_id = coalesce(
                  ${input.assigneeEmployeeId ?? null}::uuid,
                  assignee_employee_id
                ),
                updated_at = now()
            where ticket_id = ${input.requestId}::uuid
            returning *
          `);
          if (input.note) {
            await tx.execute(sql`
              insert into public.ticket_comment (
                ticket_id, body, is_internal, author_employee_id, approved_at
              ) values (
                ${input.requestId}::uuid, ${input.note}, true,
                ${current.employeeId}::uuid, now()
              )
            `);
          }
          return rows[0]!;
        });
        await audit(
          ctx,
          "workplace.serviceRequest.status",
          "ticket",
          input.requestId,
          {
            status: input.status,
            assigneeEmployeeId: input.assigneeEmployeeId ?? null,
          },
        );
        return updated;
      }),
  }),
});
