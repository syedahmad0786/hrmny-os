import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { auditEvent, desc, eq, featureRequest } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { getObjectStore } from "../storage/object-store";
import {
  canTransitionFeatureRequest,
  draftFeatureRequestPrd,
  FeatureRequestPrdSchema,
  type FeatureRequestStatus,
} from "../feature-request-prd";
import { router, staffProcedure } from "./trpc";

const statusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "rejected",
  "building",
  "shipped",
]);

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for feature requests",
    });
  }
  return db;
}

function requireEmployeeId(employeeId: string | null): string {
  if (!employeeId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Employee required" });
  }
  return employeeId;
}

export const featureRequestsRouter = router({
  list: staffProcedure.query(async () => {
    const db = requireDb();
    return db
      .select()
      .from(featureRequest)
      .orderBy(desc(featureRequest.createdAt));
  }),

  create: staffProcedure
    .input(
      z
        .object({
          title: z.string().trim().min(3).max(160),
          idea: z.string().trim().max(20_000),
          voice: z
            .object({
              fileName: z.string().min(1).max(180),
              contentType: z.string().regex(/^audio\//),
              contentBase64: z.string().min(1).max(7_000_000),
            })
            .optional(),
        })
        .superRefine((value, ctx) => {
          if (value.idea.length < 10 && !value.voice) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["idea"],
              message: "Add an idea of at least 10 characters or a voice note",
            });
          }
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = requireDb();
      const employeeId = requireEmployeeId(ctx.employeeId);
      const id = randomUUID();
      let voiceStoragePath: string | null = null;
      const rawInput =
        input.idea ||
        "Voice note attached. Transcription is pending; refine this PRD during review.";

      if (input.voice) {
        const body = Buffer.from(input.voice.contentBase64, "base64");
        if (body.byteLength > 5_000_000) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Voice notes are limited to 5 MB",
          });
        }
        const fileName = input.voice.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
        voiceStoragePath = `feature-requests/${id}/${fileName}`;
        await getObjectStore().put({
          path: voiceStoragePath,
          body: new Uint8Array(body),
          contentType: input.voice.contentType,
        });
      }

      try {
        return await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(featureRequest)
            .values({
              featureRequestId: id,
              submittedByEmployeeId: employeeId,
              title: input.title,
              rawInput,
              voiceStoragePath,
              prd: draftFeatureRequestPrd(input.title, rawInput),
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: employeeId,
            action: "featureRequest.create",
            entityType: "feature_request",
            entityId: id,
            after: { title: input.title, hasVoice: Boolean(voiceStoragePath) },
          });
          return created!;
        });
      } catch (error) {
        if (voiceStoragePath) {
          await getObjectStore().remove?.(voiceStoragePath);
        }
        throw error;
      }
    }),

  updatePrd: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        prd: FeatureRequestPrdSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = requireDb();
      const employeeId = requireEmployeeId(ctx.employeeId);
      const [existing] = await db
        .select()
        .from(featureRequest)
        .where(eq(featureRequest.featureRequestId, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["draft", "rejected"].includes(existing.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only draft or rejected PRDs can be edited",
        });
      }
      const [updated] = await db
        .update(featureRequest)
        .set({ prd: input.prd, status: "draft", updatedAt: new Date() })
        .where(eq(featureRequest.featureRequestId, input.id))
        .returning();
      await db.insert(auditEvent).values({
        actorEmployeeId: employeeId,
        action: "featureRequest.updatePrd",
        entityType: "feature_request",
        entityId: input.id,
        before: { status: existing.status },
        after: { status: "draft" },
      });
      return updated!;
    }),

  transition: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: statusSchema,
        note: z.string().trim().max(2_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = requireDb();
      const employeeId = requireEmployeeId(ctx.employeeId);
      const [existing] = await db
        .select()
        .from(featureRequest)
        .where(eq(featureRequest.featureRequestId, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const from = statusSchema.parse(existing.status) as FeatureRequestStatus;
      if (!canTransitionFeatureRequest(from, input.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Cannot move a request from ${from} to ${input.status}`,
        });
      }
      if (
        input.status !== "review" &&
        !ctx.roles.some((role) => role === "partner" || role === "developer")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Partner approval is required",
        });
      }

      const decided =
        input.status === "approved" || input.status === "rejected";
      const [updated] = await db
        .update(featureRequest)
        .set({
          status: input.status,
          approvalNote: input.note ?? null,
          approvedByEmployeeId: decided ? employeeId : null,
          approvedAt: decided ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(featureRequest.featureRequestId, input.id))
        .returning();
      await db.insert(auditEvent).values({
        actorEmployeeId: employeeId,
        action: "featureRequest.transition",
        entityType: "feature_request",
        entityId: input.id,
        before: { status: from },
        after: { status: input.status },
        reason: input.note ?? null,
      });
      return updated!;
    }),

  voiceUrl: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = requireDb();
      const [row] = await db
        .select({ voiceStoragePath: featureRequest.voiceStoragePath })
        .from(featureRequest)
        .where(eq(featureRequest.featureRequestId, input.id))
        .limit(1);
      if (!row?.voiceStoragePath) return null;
      return getObjectStore().signedUrl(row.voiceStoragePath, 300);
    }),
});
