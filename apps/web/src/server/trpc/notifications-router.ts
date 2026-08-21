import { z } from "zod";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyEmployee,
} from "../notifications/store";
import { protectedProcedure, router, staffProcedure } from "./trpc";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          unreadOnly: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.employeeId) return [];
      return listNotifications(ctx.employeeId, {
        unreadOnly: input?.unreadOnly,
        limit: input?.limit,
      });
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.employeeId) return { count: 0 };
    const rows = await listNotifications(ctx.employeeId, {
      unreadOnly: true,
      limit: 100,
    });
    return { count: rows.length };
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.employeeId) return { ok: false };
      const ok = await markNotificationRead(ctx.employeeId, input.id);
      return { ok };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.employeeId) return { count: 0 };
    const count = await markAllNotificationsRead(ctx.employeeId);
    return { count };
  }),

  /** Staff can nudge another employee (or self) with an OS notification. */
  send: staffProcedure
    .input(
      z.object({
        employeeId: z.string().uuid(),
        title: z.string().min(1).max(200),
        body: z.string().max(2000).optional(),
        kind: z.string().max(40).optional(),
        href: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return notifyEmployee({
        employeeId: input.employeeId,
        title: input.title,
        body: input.body,
        kind: input.kind,
        href: input.href,
      });
    }),
});
