import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  DIGITAL_CARD_PUBLIC_FIELDS,
  isDigitalCardAdmin,
  normalizeCardSlug,
  toPublicDigitalCard,
  type DigitalCardRow,
} from "../digital-cards";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import {
  publicProcedure,
  router,
  staffProcedure,
  type TrpcContext,
} from "./trpc";

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for digital cards",
    });
  }
  return db;
}

function actor(ctx: TrpcContext) {
  if (!ctx.employeeId || !ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return { employeeId: ctx.employeeId, roles: ctx.roles };
}

function requireAdmin(ctx: TrpcContext) {
  if (!isDigitalCardAdmin(actor(ctx).roles)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "HR access required" });
  }
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
const optionalHttpsUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .regex(/^https:\/\//i, "HTTPS required")
  .optional();
const publicField = z.enum(DIGITAL_CARD_PUBLIC_FIELDS);
const publicFields = z
  .array(publicField)
  .max(DIGITAL_CARD_PUBLIC_FIELDS.length)
  .refine(
    (value) => new Set(value).size === value.length,
    "Duplicate public field",
  );
const slug = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/)
  .transform(normalizeCardSlug);

export async function getPublicDigitalCard(value: string) {
  let normalized: string;
  try {
    normalized = normalizeCardSlug(value);
  } catch {
    return null;
  }
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute(sql<DigitalCardRow>`
    select
      c.slug,
      c.display_name,
      c.job_title,
      c.work_email,
      c.phone,
      c.website,
      c.location,
      c.bio,
      c.photo_url,
      c.linkedin_url,
      c.public_fields,
      c.is_active,
      c.revoked_at,
      c.admin_disabled_at,
      t.company_name,
      t.accent_color,
      t.logo_url
    from public.employee_digital_card c
    left join public.digital_card_template t
      on t.digital_card_template_id = c.digital_card_template_id
    where c.slug = ${normalized}
    limit 1
  `);
  return rows[0]
    ? toPublicDigitalCard(rows[0] as unknown as DigitalCardRow)
    : null;
}

export const digitalCardsRouter = router({
  publicBySlug: publicProcedure
    .input(z.object({ slug }))
    .query(({ input }) => getPublicDigitalCard(input.slug)),

  templates: staffProcedure.query(() =>
    requireDb().execute(sql`
      select *
      from public.digital_card_template
      where is_active = true
      order by is_default desc, name
    `),
  ),

  me: router({
    get: staffProcedure.query(async ({ ctx }) => {
      const current = actor(ctx);
      const rows = await requireDb().execute(sql`
        select
          c.*,
          e.display_name as employee_display_name,
          e.job_title as employee_job_title,
          e.email as employee_work_email,
          t.company_name,
          t.accent_color,
          t.logo_url
        from public.employee e
        left join public.employee_digital_card c on c.employee_id = e.employee_id
        left join public.digital_card_template t
          on t.digital_card_template_id = c.digital_card_template_id
        where e.employee_id = ${current.employeeId}::uuid
        limit 1
      `);
      return rows[0] ?? null;
    }),

    upsert: staffProcedure
      .input(
        z.object({
          slug,
          templateId: uuid.nullable().optional(),
          displayName: z.string().trim().min(1).max(160),
          jobTitle: z.string().trim().max(160).optional(),
          workEmail: z.string().trim().email().max(320).optional(),
          phone: z.string().trim().max(40).optional(),
          website: optionalHttpsUrl,
          location: z.string().trim().max(160).optional(),
          bio: z.string().trim().max(500).optional(),
          photoUrl: optionalHttpsUrl,
          linkedinUrl: optionalHttpsUrl,
          publicFields,
          isActive: z.boolean().default(true),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = actor(ctx);
        if (input.templateId) {
          const template = await requireDb().execute(sql`
            select digital_card_template_id
            from public.digital_card_template
            where digital_card_template_id = ${input.templateId}::uuid
              and is_active = true
            limit 1
          `);
          if (!template[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        const rows = await requireDb().execute(sql`
          insert into public.employee_digital_card (
            employee_id, digital_card_template_id, slug, display_name,
            job_title, work_email, phone, website, location, bio, photo_url,
            linkedin_url, public_fields, is_active, revoked_at
          ) values (
            ${current.employeeId}::uuid,
            ${input.templateId ?? null}::uuid,
            ${input.slug},
            ${input.displayName},
            ${input.jobTitle ?? null},
            ${input.workEmail ?? null},
            ${input.phone ?? null},
            ${input.website ?? null},
            ${input.location ?? null},
            ${input.bio ?? null},
            ${input.photoUrl ?? null},
            ${input.linkedinUrl ?? null},
            ARRAY(
              SELECT jsonb_array_elements_text(
                ${JSON.stringify(input.publicFields)}::jsonb
              )
            ),
            ${input.isActive},
            ${input.isActive ? null : new Date()}::timestamptz
          )
          on conflict (employee_id) do update set
            digital_card_template_id = excluded.digital_card_template_id,
            slug = excluded.slug,
            display_name = excluded.display_name,
            job_title = excluded.job_title,
            work_email = excluded.work_email,
            phone = excluded.phone,
            website = excluded.website,
            location = excluded.location,
            bio = excluded.bio,
            photo_url = excluded.photo_url,
            linkedin_url = excluded.linkedin_url,
            public_fields = excluded.public_fields,
            is_active = case
              when employee_digital_card.admin_disabled_at is null
                then excluded.is_active
              else false
            end,
            revoked_at = case
              when employee_digital_card.admin_disabled_at is not null
                then coalesce(employee_digital_card.revoked_at, now())
              else excluded.revoked_at
            end,
            updated_at = now()
          returning *
        `);
        const card = rows[0]!;
        await audit(
          ctx,
          "digitalCard.upsert",
          "employee_digital_card",
          String(card.employee_digital_card_id),
          {
            slug: input.slug,
            publicFields: input.publicFields,
            isActive: input.isActive,
          },
        );
        return card;
      }),

    revoke: staffProcedure.mutation(async ({ ctx }) => {
      const current = actor(ctx);
      const rows = await requireDb().execute(sql`
        update public.employee_digital_card
        set is_active = false, revoked_at = now(), updated_at = now()
        where employee_id = ${current.employeeId}::uuid
        returning employee_digital_card_id, slug
      `);
      const card = rows[0];
      if (!card) throw new TRPCError({ code: "NOT_FOUND" });
      await audit(
        ctx,
        "digitalCard.revoke",
        "employee_digital_card",
        String(card.employee_digital_card_id),
        { slug: card.slug },
      );
      return card;
    }),
  }),

  admin: router({
    cards: staffProcedure.query(async ({ ctx }) => {
      requireAdmin(ctx);
      return requireDb().execute(sql`
        select c.*, e.display_name as employee_name, e.email as employee_email
        from public.employee_digital_card c
        join public.employee e on e.employee_id = c.employee_id
        order by e.display_name
      `);
    }),

    setCardActive: staffProcedure
      .input(z.object({ cardId: uuid, active: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          update public.employee_digital_card
          set
            is_active = ${input.active},
            revoked_at = ${input.active ? null : new Date()}::timestamptz,
            admin_disabled_at = ${input.active ? null : new Date()}::timestamptz,
            updated_at = now()
          where employee_digital_card_id = ${input.cardId}::uuid
          returning employee_digital_card_id, slug
        `);
        const card = rows[0];
        if (!card) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          input.active
            ? "digitalCard.admin.enable"
            : "digitalCard.admin.disable",
          "employee_digital_card",
          input.cardId,
          { active: input.active, slug: card.slug },
        );
        return card;
      }),

    templates: staffProcedure.query(async ({ ctx }) => {
      requireAdmin(ctx);
      return requireDb().execute(sql`
        select * from public.digital_card_template
        order by is_default desc, name
      `);
    }),

    upsertTemplate: staffProcedure
      .input(
        z
          .object({
            templateId: uuid.optional(),
            name: z.string().trim().min(2).max(120),
            companyName: z.string().trim().min(2).max(160),
            accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
            logoUrl: optionalHttpsUrl,
            isDefault: z.boolean().default(false),
            isActive: z.boolean().default(true),
          })
          .refine((value) => value.isActive || !value.isDefault, {
            message: "The default template must remain active",
          }),
      )
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx);
        const template = await requireDb().transaction(async (tx) => {
          if (input.isDefault) {
            await tx.execute(sql`
              update public.digital_card_template
              set is_default = false, updated_at = now()
              where is_default = true
            `);
          }
          if (input.templateId) {
            const rows = await tx.execute(sql`
              update public.digital_card_template
              set name = ${input.name},
                  company_name = ${input.companyName},
                  accent_color = ${input.accentColor},
                  logo_url = ${input.logoUrl ?? null},
                  is_default = ${input.isDefault},
                  is_active = ${input.isActive},
                  updated_at = now()
              where digital_card_template_id = ${input.templateId}::uuid
              returning *
            `);
            if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
            return rows[0];
          }
          const rows = await tx.execute(sql`
            insert into public.digital_card_template (
              name, company_name, accent_color, logo_url, is_default, is_active
            ) values (
              ${input.name}, ${input.companyName}, ${input.accentColor},
              ${input.logoUrl ?? null}, ${input.isDefault}, ${input.isActive}
            )
            returning *
          `);
          return rows[0]!;
        });
        await audit(
          ctx,
          "digitalCard.template.upsert",
          "digital_card_template",
          String(template.digital_card_template_id),
          {
            name: input.name,
            isDefault: input.isDefault,
            isActive: input.isActive,
          },
        );
        return template;
      }),

    setTemplateActive: staffProcedure
      .input(z.object({ templateId: uuid, active: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        requireAdmin(ctx);
        const rows = await requireDb().execute(sql`
          update public.digital_card_template
          set is_active = ${input.active},
              is_default = case when ${input.active} then is_default else false end,
              updated_at = now()
          where digital_card_template_id = ${input.templateId}::uuid
          returning *
        `);
        const template = rows[0];
        if (!template) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          input.active
            ? "digitalCard.template.enable"
            : "digitalCard.template.disable",
          "digital_card_template",
          input.templateId,
          { active: input.active },
        );
        return template;
      }),
  }),
});
