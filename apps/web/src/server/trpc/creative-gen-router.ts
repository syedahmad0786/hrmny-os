import { generateImage } from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { notifyEmployee } from "../notifications/store";
import { staffProcedure, router } from "./trpc";

type GenRow = {
  creativeGenerationId: string;
  employeeId: string | null;
  clientId: string | null;
  taskId: string | null;
  prompt: string;
  model: string;
  status: string;
  imageUrl: string | null;
  imageB64: string | null;
  error: string | null;
  createdAt: string;
};

const memGens: GenRow[] = [];

export const creativeGenRouter = router({
  list: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const db = getDb();
      if (!db) {
        return memGens
          .filter((g) => g.employeeId === ctx.employeeId)
          .slice(0, limit);
      }
      return db.execute<GenRow>(sql`
        select
          creative_generation_id as "creativeGenerationId",
          employee_id as "employeeId",
          client_id as "clientId",
          task_id as "taskId",
          prompt, model, status,
          image_url as "imageUrl",
          image_b64 as "imageB64",
          error,
          created_at::text as "createdAt"
        from public.creative_generation
        where employee_id = ${ctx.employeeId!}::uuid
        order by created_at desc
        limit ${limit}
      `);
    }),

  generate: staffProcedure
    .input(
      z.object({
        prompt: z.string().min(3).max(2000),
        model: z.string().max(120).optional(),
        clientId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
        size: z.enum(["1024x1024", "1792x1024", "1024x1792"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId!;
      const result = await generateImage({
        prompt: input.prompt,
        model: input.model,
        size: input.size,
      });
      const status = result.imageUrl || result.imageB64 ? "ready" : "failed";
      const row: GenRow = {
        creativeGenerationId: crypto.randomUUID(),
        employeeId,
        clientId: input.clientId ?? null,
        taskId: input.taskId ?? null,
        prompt: input.prompt,
        model: result.model,
        status,
        imageUrl: result.imageUrl,
        imageB64: result.imageB64,
        error: status === "failed" ? "No image returned" : null,
        createdAt: new Date().toISOString(),
      };

      const db = getDb();
      if (!db) {
        memGens.unshift(row);
      } else {
        const saved = await db.execute<GenRow>(sql`
          insert into public.creative_generation (
            creative_generation_id, employee_id, client_id, task_id,
            prompt, model, status, image_url, image_b64, error, metadata
          ) values (
            ${row.creativeGenerationId}::uuid,
            ${employeeId}::uuid,
            ${input.clientId ?? null}::uuid,
            ${input.taskId ?? null}::uuid,
            ${input.prompt},
            ${result.model},
            ${status},
            ${result.imageUrl},
            ${result.imageB64},
            ${row.error},
            ${JSON.stringify({ provider: result.provider })}::jsonb
          )
          returning
            creative_generation_id as "creativeGenerationId",
            employee_id as "employeeId",
            client_id as "clientId",
            task_id as "taskId",
            prompt, model, status,
            image_url as "imageUrl",
            image_b64 as "imageB64",
            error,
            created_at::text as "createdAt"
        `);
        Object.assign(row, saved[0]);
      }

      await notifyEmployee({
        employeeId,
        title: status === "ready" ? "Image ready" : "Image generation failed",
        body: input.prompt.slice(0, 120),
        kind: "creative",
        href: "/creative",
        entityType: "creative_generation",
        entityId: row.creativeGenerationId,
      }).catch(() => undefined);

      return { ...row, provider: result.provider };
    }),
});
