import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { notifyEmployee } from "../notifications/store";
import { protectedProcedure, publicProcedure, router } from "./trpc";

const ticketStatusSchema = z.enum([
  "new",
  "triaged",
  "open",
  "pending_requester",
  "pending_internal",
  "resolved",
  "closed",
]);
const ticketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const requesterTypeSchema = z.enum(["employee", "portal_user"]);

type TicketRow = {
  ticketId: string;
  subject: string;
  body: string | null;
  status: z.infer<typeof ticketStatusSchema>;
  priority: z.infer<typeof ticketPrioritySchema>;
  requesterType: z.infer<typeof requesterTypeSchema>;
  requesterEmployeeId: string | null;
  requesterPortalUserId: string | null;
  assigneeEmployeeId: string | null;
  companyId: string | null;
  dealId: string | null;
  clientId: string | null;
  aiClassification: string | null;
  aiSuggestedAssigneeId: string | null;
  aiDraftReply: string | null;
  aiDraftApprovedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TicketCommentRow = {
  ticketCommentId: string;
  ticketId: string;
  body: string;
  isInternal: boolean;
  isAiDraft: boolean;
  authorEmployeeId: string | null;
  authorPortalUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
};

const memTickets = new Map<string, TicketRow>();
const memComments = new Map<string, TicketCommentRow>();

function nowIso() {
  return new Date().toISOString();
}

async function listDb(filter?: {
  status?: string;
  priority?: string;
  assigneeEmployeeId?: string;
  companyId?: string;
  clientId?: string;
  dealId?: string;
}): Promise<TicketRow[]> {
  const db = getDb();
  if (!db) return [];
  return db.execute<TicketRow>(sql`
    select
      ticket_id as "ticketId", subject, body, status, priority,
      requester_type as "requesterType",
      requester_employee_id as "requesterEmployeeId",
      requester_portal_user_id as "requesterPortalUserId",
      assignee_employee_id as "assigneeEmployeeId",
      company_id as "companyId", deal_id as "dealId", client_id as "clientId",
      ai_classification as "aiClassification",
      ai_suggested_assignee_id as "aiSuggestedAssigneeId",
      ai_draft_reply as "aiDraftReply",
      ai_draft_approved_at::text as "aiDraftApprovedAt",
      created_at::text as "createdAt", updated_at::text as "updatedAt"
    from public.ticket
    where (${filter?.status ?? null}::text is null or status::text = ${filter?.status ?? null})
      and (${filter?.priority ?? null}::text is null or priority::text = ${filter?.priority ?? null})
      and (${filter?.assigneeEmployeeId ?? null}::uuid is null or assignee_employee_id = ${filter?.assigneeEmployeeId ?? null}::uuid)
      and (${filter?.companyId ?? null}::uuid is null or company_id = ${filter?.companyId ?? null}::uuid)
      and (${filter?.clientId ?? null}::uuid is null or client_id = ${filter?.clientId ?? null}::uuid)
      and (${filter?.dealId ?? null}::uuid is null or deal_id = ${filter?.dealId ?? null}::uuid)
    order by updated_at desc
    limit 200
  `);
}

export const ticketsRouter = router({
  health: publicProcedure.query(async () => {
    const db = getDb();
    if (!db) {
      return {
        mode: "memory" as const,
        ticketCount: memTickets.size,
        commentCount: memComments.size,
      };
    }
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from public.ticket
    `);
    return {
      mode: "postgres" as const,
      ticketCount: rows[0]?.n ?? 0,
      commentCount: 0,
    };
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          status: ticketStatusSchema.optional(),
          priority: ticketPrioritySchema.optional(),
          assigneeEmployeeId: z.string().uuid().optional(),
          companyId: z.string().uuid().optional(),
          clientId: z.string().uuid().optional(),
          dealId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      if (getDb()) return listDb(input);
      let rows = [...memTickets.values()];
      if (input?.status) rows = rows.filter((t) => t.status === input.status);
      if (input?.priority)
        rows = rows.filter((t) => t.priority === input.priority);
      if (input?.assigneeEmployeeId)
        rows = rows.filter(
          (t) => t.assigneeEmployeeId === input.assigneeEmployeeId,
        );
      if (input?.companyId)
        rows = rows.filter((t) => t.companyId === input.companyId);
      if (input?.clientId)
        rows = rows.filter((t) => t.clientId === input.clientId);
      if (input?.dealId) rows = rows.filter((t) => t.dealId === input.dealId);
      return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      if (db) {
        const tickets = await db.execute<TicketRow>(sql`
          select
            ticket_id as "ticketId", subject, body, status, priority,
            requester_type as "requesterType",
            requester_employee_id as "requesterEmployeeId",
            requester_portal_user_id as "requesterPortalUserId",
            assignee_employee_id as "assigneeEmployeeId",
            company_id as "companyId", deal_id as "dealId", client_id as "clientId",
            ai_classification as "aiClassification",
            ai_suggested_assignee_id as "aiSuggestedAssigneeId",
            ai_draft_reply as "aiDraftReply",
            ai_draft_approved_at::text as "aiDraftApprovedAt",
            created_at::text as "createdAt", updated_at::text as "updatedAt"
          from public.ticket where ticket_id = ${input.id}::uuid limit 1
        `);
        const ticket = tickets[0];
        if (!ticket) return null;
        const thread = await db.execute<TicketCommentRow>(sql`
          select
            ticket_comment_id as "ticketCommentId", ticket_id as "ticketId",
            body, is_internal as "isInternal", is_ai_draft as "isAiDraft",
            author_employee_id as "authorEmployeeId",
            author_portal_user_id as "authorPortalUserId",
            approved_at::text as "approvedAt", created_at::text as "createdAt"
          from public.ticket_comment
          where ticket_id = ${input.id}::uuid
          order by created_at
        `);
        return { ...ticket, comments: thread };
      }
      const ticket = memTickets.get(input.id);
      if (!ticket) return null;
      const thread = [...memComments.values()]
        .filter((c) => c.ticketId === input.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { ...ticket, comments: thread };
    }),

  create: protectedProcedure
    .input(
      z.object({
        subject: z.string().min(1),
        body: z.string().nullable().optional(),
        priority: ticketPrioritySchema.optional(),
        requesterType: requesterTypeSchema.default("employee"),
        requesterPortalUserId: z.string().uuid().nullable().optional(),
        assigneeEmployeeId: z.string().uuid().nullable().optional(),
        companyId: z.string().uuid().nullable().optional(),
        dealId: z.string().uuid().nullable().optional(),
        clientId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (db) {
        const rows = await db.execute<TicketRow>(sql`
          insert into public.ticket (
            subject, body, status, priority, requester_type,
            requester_employee_id, requester_portal_user_id, assignee_employee_id,
            company_id, deal_id, client_id
          ) values (
            ${input.subject},
            ${input.body ?? null},
            'new',
            ${(input.priority ?? "medium")}::ticket_priority_enum,
            ${input.requesterType}::ticket_requester_type_enum,
            ${input.requesterType === "employee" ? ctx.employeeId : null}::uuid,
            ${input.requesterPortalUserId ?? null}::uuid,
            ${input.assigneeEmployeeId ?? null}::uuid,
            ${input.companyId ?? null}::uuid,
            ${input.dealId ?? null}::uuid,
            ${input.clientId ?? null}::uuid
          )
          returning
            ticket_id as "ticketId", subject, body, status, priority,
            requester_type as "requesterType",
            requester_employee_id as "requesterEmployeeId",
            requester_portal_user_id as "requesterPortalUserId",
            assignee_employee_id as "assigneeEmployeeId",
            company_id as "companyId", deal_id as "dealId", client_id as "clientId",
            ai_classification as "aiClassification",
            ai_suggested_assignee_id as "aiSuggestedAssigneeId",
            ai_draft_reply as "aiDraftReply",
            ai_draft_approved_at::text as "aiDraftApprovedAt",
            created_at::text as "createdAt", updated_at::text as "updatedAt"
        `);
        const row = rows[0]!;
        if (row.assigneeEmployeeId) {
          await notifyEmployee({
            employeeId: row.assigneeEmployeeId,
            title: `Ticket assigned: ${row.subject}`,
            body: row.body,
            kind: "ticket",
            href: `/tickets`,
            entityType: "ticket",
            entityId: row.ticketId,
          });
        }
        return row;
      }
      const ts = nowIso();
      const row: TicketRow = {
        ticketId: crypto.randomUUID(),
        subject: input.subject,
        body: input.body ?? null,
        status: "new",
        priority: input.priority ?? "medium",
        requesterType: input.requesterType,
        requesterEmployeeId:
          input.requesterType === "employee" ? ctx.employeeId : null,
        requesterPortalUserId: input.requesterPortalUserId ?? null,
        assigneeEmployeeId: input.assigneeEmployeeId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        clientId: input.clientId ?? null,
        aiClassification: null,
        aiSuggestedAssigneeId: null,
        aiDraftReply: null,
        aiDraftApprovedAt: null,
        createdAt: ts,
        updatedAt: ts,
      };
      memTickets.set(row.ticketId, row);
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        subject: z.string().min(1).optional(),
        body: z.string().nullable().optional(),
        status: ticketStatusSchema.optional(),
        priority: ticketPrioritySchema.optional(),
        assigneeEmployeeId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      if (db) {
        const rows = await db.execute<TicketRow>(sql`
          update public.ticket set
            subject = coalesce(${input.subject ?? null}, subject),
            body = case when ${input.body !== undefined} then ${input.body ?? null} else body end,
            status = coalesce(${input.status ?? null}::ticket_status_enum, status),
            priority = coalesce(${input.priority ?? null}::ticket_priority_enum, priority),
            assignee_employee_id = case
              when ${input.assigneeEmployeeId !== undefined} then ${input.assigneeEmployeeId ?? null}::uuid
              else assignee_employee_id end,
            updated_at = now()
          where ticket_id = ${input.id}::uuid
          returning
            ticket_id as "ticketId", subject, body, status, priority,
            requester_type as "requesterType",
            requester_employee_id as "requesterEmployeeId",
            requester_portal_user_id as "requesterPortalUserId",
            assignee_employee_id as "assigneeEmployeeId",
            company_id as "companyId", deal_id as "dealId", client_id as "clientId",
            ai_classification as "aiClassification",
            ai_suggested_assignee_id as "aiSuggestedAssigneeId",
            ai_draft_reply as "aiDraftReply",
            ai_draft_approved_at::text as "aiDraftApprovedAt",
            created_at::text as "createdAt", updated_at::text as "updatedAt"
        `);
        if (!rows[0]) throw new Error("NOT_FOUND");
        return rows[0];
      }
      const existing = memTickets.get(input.id);
      if (!existing) throw new Error("NOT_FOUND");
      const next: TicketRow = {
        ...existing,
        subject: input.subject ?? existing.subject,
        body: input.body !== undefined ? input.body : existing.body,
        status: input.status ?? existing.status,
        priority: input.priority ?? existing.priority,
        assigneeEmployeeId:
          input.assigneeEmployeeId !== undefined
            ? input.assigneeEmployeeId
            : existing.assigneeEmployeeId,
        updatedAt: nowIso(),
      };
      memTickets.set(input.id, next);
      return next;
    }),

  addComment: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        body: z.string().min(1),
        isInternal: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (db) {
        const rows = await db.execute<TicketCommentRow>(sql`
          insert into public.ticket_comment (
            ticket_id, body, is_internal, is_ai_draft, author_employee_id, approved_at
          ) values (
            ${input.ticketId}::uuid, ${input.body},
            ${input.isInternal ?? false}, false,
            ${ctx.employeeId}::uuid, now()
          )
          returning
            ticket_comment_id as "ticketCommentId", ticket_id as "ticketId",
            body, is_internal as "isInternal", is_ai_draft as "isAiDraft",
            author_employee_id as "authorEmployeeId",
            author_portal_user_id as "authorPortalUserId",
            approved_at::text as "approvedAt", created_at::text as "createdAt"
        `);
        await db.execute(sql`
          update public.ticket set updated_at = now()
          where ticket_id = ${input.ticketId}::uuid
        `);
        return rows[0]!;
      }
      if (!memTickets.has(input.ticketId)) throw new Error("NOT_FOUND");
      const row: TicketCommentRow = {
        ticketCommentId: crypto.randomUUID(),
        ticketId: input.ticketId,
        body: input.body,
        isInternal: input.isInternal ?? false,
        isAiDraft: false,
        authorEmployeeId: ctx.employeeId,
        authorPortalUserId: null,
        approvedAt: nowIso(),
        createdAt: nowIso(),
      };
      memComments.set(row.ticketCommentId, row);
      return row;
    }),

  aiTriage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      if (db) {
        const rows = await db.execute<TicketRow>(sql`
          update public.ticket set
            status = case when status = 'new' then 'triaged'::ticket_status_enum else status end,
            ai_classification = 'general_support',
            priority = case when priority = 'low' then 'medium'::ticket_priority_enum else priority end,
            updated_at = now()
          where ticket_id = ${input.id}::uuid
          returning
            ticket_id as "ticketId", subject, body, status, priority,
            requester_type as "requesterType",
            requester_employee_id as "requesterEmployeeId",
            requester_portal_user_id as "requesterPortalUserId",
            assignee_employee_id as "assigneeEmployeeId",
            company_id as "companyId", deal_id as "dealId", client_id as "clientId",
            ai_classification as "aiClassification",
            ai_suggested_assignee_id as "aiSuggestedAssigneeId",
            ai_draft_reply as "aiDraftReply",
            ai_draft_approved_at::text as "aiDraftApprovedAt",
            created_at::text as "createdAt", updated_at::text as "updatedAt"
        `);
        if (!rows[0]) throw new Error("NOT_FOUND");
        return {
          ticket: rows[0],
          hitlRequired: true,
          note: "AI suggestions only — human confirms assignee/priority",
        };
      }
      const existing = memTickets.get(input.id);
      if (!existing) throw new Error("NOT_FOUND");
      const next = {
        ...existing,
        status:
          existing.status === "new"
            ? ("triaged" as const)
            : existing.status,
        aiClassification: "general_support",
        priority:
          existing.priority === "low"
            ? ("medium" as const)
            : existing.priority,
        updatedAt: nowIso(),
      };
      memTickets.set(input.id, next);
      return { ticket: next, hitlRequired: true, note: "AI suggestions only" };
    }),

  aiDraftReply: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const draftBase = async (subject: string) =>
        `Thanks for reaching out about “${subject}”. We’re looking into this and will follow up shortly.`;
      const db = getDb();
      if (db) {
        const existing = await db.execute<{ subject: string }>(sql`
          select subject from public.ticket where ticket_id = ${input.id}::uuid limit 1
        `);
        if (!existing[0]) throw new Error("NOT_FOUND");
        const draft = await draftBase(existing[0].subject);
        const rows = await db.execute<TicketRow>(sql`
          update public.ticket set
            ai_draft_reply = ${draft}, ai_draft_approved_at = null, updated_at = now()
          where ticket_id = ${input.id}::uuid
          returning
            ticket_id as "ticketId", subject, body, status, priority,
            requester_type as "requesterType",
            requester_employee_id as "requesterEmployeeId",
            requester_portal_user_id as "requesterPortalUserId",
            assignee_employee_id as "assigneeEmployeeId",
            company_id as "companyId", deal_id as "dealId", client_id as "clientId",
            ai_classification as "aiClassification",
            ai_suggested_assignee_id as "aiSuggestedAssigneeId",
            ai_draft_reply as "aiDraftReply",
            ai_draft_approved_at::text as "aiDraftApprovedAt",
            created_at::text as "createdAt", updated_at::text as "updatedAt"
        `);
        await db.execute(sql`
          insert into public.ticket_comment (
            ticket_id, body, is_internal, is_ai_draft
          ) values (${input.id}::uuid, ${draft}, true, true)
        `);
        return {
          ticket: rows[0]!,
          hitlRequired: true,
          note: "Client-visible send blocked until tickets.approveAiDraft",
        };
      }
      const existing = memTickets.get(input.id);
      if (!existing) throw new Error("NOT_FOUND");
      const draft = await draftBase(existing.subject);
      const next = {
        ...existing,
        aiDraftReply: draft,
        aiDraftApprovedAt: null,
        updatedAt: nowIso(),
      };
      memTickets.set(input.id, next);
      return { ticket: next, hitlRequired: true, note: "HITL required" };
    }),

  approveAiDraft: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        editedBody: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (db) {
        const current = await db.execute<{ aiDraftReply: string | null }>(sql`
          select ai_draft_reply as "aiDraftReply"
          from public.ticket where ticket_id = ${input.id}::uuid limit 1
        `);
        const draft = input.editedBody ?? current[0]?.aiDraftReply;
        if (!draft) throw new Error("NOT_FOUND");
        const rows = await db.execute<TicketRow>(sql`
          update public.ticket set
            ai_draft_reply = ${draft},
            ai_draft_approved_at = now(),
            updated_at = now()
          where ticket_id = ${input.id}::uuid
          returning
            ticket_id as "ticketId", subject, body, status, priority,
            requester_type as "requesterType",
            requester_employee_id as "requesterEmployeeId",
            requester_portal_user_id as "requesterPortalUserId",
            assignee_employee_id as "assigneeEmployeeId",
            company_id as "companyId", deal_id as "dealId", client_id as "clientId",
            ai_classification as "aiClassification",
            ai_suggested_assignee_id as "aiSuggestedAssigneeId",
            ai_draft_reply as "aiDraftReply",
            ai_draft_approved_at::text as "aiDraftApprovedAt",
            created_at::text as "createdAt", updated_at::text as "updatedAt"
        `);
        const comment = await db.execute<TicketCommentRow>(sql`
          insert into public.ticket_comment (
            ticket_id, body, is_internal, is_ai_draft, author_employee_id, approved_at
          ) values (
            ${input.id}::uuid, ${draft}, false, false, ${ctx.employeeId}::uuid, now()
          )
          returning
            ticket_comment_id as "ticketCommentId", ticket_id as "ticketId",
            body, is_internal as "isInternal", is_ai_draft as "isAiDraft",
            author_employee_id as "authorEmployeeId",
            author_portal_user_id as "authorPortalUserId",
            approved_at::text as "approvedAt", created_at::text as "createdAt"
        `);
        return { ticket: rows[0]!, publishedComment: comment[0]! };
      }
      const existing = memTickets.get(input.id);
      if (!existing?.aiDraftReply) throw new Error("NOT_FOUND");
      const body = input.editedBody ?? existing.aiDraftReply;
      const approvedAt = nowIso();
      const next = {
        ...existing,
        aiDraftReply: body,
        aiDraftApprovedAt: approvedAt,
        updatedAt: approvedAt,
      };
      memTickets.set(input.id, next);
      return {
        ticket: next,
        publishedComment: {
          ticketCommentId: crypto.randomUUID(),
          ticketId: input.id,
          body,
          isInternal: false,
          isAiDraft: false,
          authorEmployeeId: ctx.employeeId,
          authorPortalUserId: null,
          approvedAt,
          createdAt: approvedAt,
        },
      };
    }),
});
