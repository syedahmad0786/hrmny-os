import { randomUUID } from "node:crypto";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./trpc";

/**
 * Ticketing stubs — in-memory until DATABASE_URL + 0004_tickets applied.
 * AI triage/draft helpers are stubs; client-visible replies always HITL.
 */

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

const tickets = new Map<string, TicketRow>();
const comments = new Map<string, TicketCommentRow>();

function nowIso() {
  return new Date().toISOString();
}

export const ticketsRouter = router({
  health: publicProcedure.query(() => ({
    mode: "memory" as const,
    ticketCount: tickets.size,
    commentCount: comments.size,
    note: "Apply packages/db/migrations/0004_tickets.sql for Postgres persistence",
  })),

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
    .query(({ input }) => {
      let rows = [...tickets.values()];
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
    .query(({ input }) => {
      const ticket = tickets.get(input.id);
      if (!ticket) return null;
      const thread = [...comments.values()]
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
    .mutation(({ input, ctx }) => {
      const ts = nowIso();
      const row: TicketRow = {
        ticketId: randomUUID(),
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
      tickets.set(row.ticketId, row);
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
    .mutation(({ input }) => {
      const existing = tickets.get(input.id);
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
      tickets.set(input.id, next);
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
    .mutation(({ input, ctx }) => {
      if (!tickets.has(input.ticketId)) throw new Error("NOT_FOUND");
      const row: TicketCommentRow = {
        ticketCommentId: randomUUID(),
        ticketId: input.ticketId,
        body: input.body,
        isInternal: input.isInternal ?? false,
        isAiDraft: false,
        authorEmployeeId: ctx.employeeId,
        authorPortalUserId: null,
        approvedAt: nowIso(),
        createdAt: nowIso(),
      };
      comments.set(row.ticketCommentId, row);
      const t = tickets.get(input.ticketId)!;
      tickets.set(input.ticketId, { ...t, updatedAt: nowIso() });
      return row;
    }),

  /** Stub: classify + prioritize + suggest assignee (no persistence side-effects beyond ticket fields). */
  aiTriage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      const existing = tickets.get(input.id);
      if (!existing) throw new Error("NOT_FOUND");
      const next: TicketRow = {
        ...existing,
        status: existing.status === "new" ? "triaged" : existing.status,
        aiClassification: "general_support",
        aiSuggestedAssigneeId: existing.assigneeEmployeeId,
        priority:
          existing.priority === "low" ? "medium" : existing.priority,
        updatedAt: nowIso(),
      };
      tickets.set(input.id, next);
      return {
        ticket: next,
        hitlRequired: true,
        note: "AI suggestions only — human confirms assignee/priority",
      };
    }),

  /** Stub: draft a reply; never client-visible until approveAiDraft. */
  aiDraftReply: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => {
      const existing = tickets.get(input.id);
      if (!existing) throw new Error("NOT_FOUND");
      const draft =
        `Thanks for reaching out about “${existing.subject}”. We’re looking into this and will follow up shortly.`;
      const next: TicketRow = {
        ...existing,
        aiDraftReply: draft,
        aiDraftApprovedAt: null,
        updatedAt: nowIso(),
      };
      tickets.set(input.id, next);
      const comment: TicketCommentRow = {
        ticketCommentId: randomUUID(),
        ticketId: input.id,
        body: draft,
        isInternal: true,
        isAiDraft: true,
        authorEmployeeId: null,
        authorPortalUserId: null,
        approvedAt: null,
        createdAt: nowIso(),
      };
      comments.set(comment.ticketCommentId, comment);
      return {
        ticket: next,
        draftComment: comment,
        hitlRequired: true,
        note: "Client-visible send blocked until tickets.approveAiDraft",
      };
    }),

  approveAiDraft: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        editedBody: z.string().min(1).optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const existing = tickets.get(input.id);
      if (!existing?.aiDraftReply) throw new Error("NOT_FOUND");
      const body = input.editedBody ?? existing.aiDraftReply;
      const approvedAt = nowIso();
      const next: TicketRow = {
        ...existing,
        aiDraftReply: body,
        aiDraftApprovedAt: approvedAt,
        updatedAt: approvedAt,
      };
      tickets.set(input.id, next);
      const comment: TicketCommentRow = {
        ticketCommentId: randomUUID(),
        ticketId: input.id,
        body,
        isInternal: false,
        isAiDraft: false,
        authorEmployeeId: ctx.employeeId,
        authorPortalUserId: null,
        approvedAt,
        createdAt: approvedAt,
      };
      comments.set(comment.ticketCommentId, comment);
      return { ticket: next, publishedComment: comment };
    }),
});
