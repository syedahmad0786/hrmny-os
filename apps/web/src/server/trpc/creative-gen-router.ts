import { generateImage } from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { notifyEmployee } from "../notifications/store";
import {
  seedClientCreativeTask,
  updateDeliveryTaskStatus,
} from "../tasks/delivery-tasks";
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

async function loadGeneration(
  id: string,
  employeeId: string,
): Promise<GenRow | null> {
  const db = getDb();
  if (!db) {
    return (
      memGens.find(
        (g) =>
          g.creativeGenerationId === id && g.employeeId === employeeId,
      ) ?? null
    );
  }
  const rows = await db.execute<GenRow>(sql`
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
    where creative_generation_id = ${id}::uuid
      and employee_id = ${employeeId}::uuid
    limit 1
  `);
  return rows[0] ?? null;
}

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

  /**
   * Attach a ready generation to a client portal deliverable:
   * asset (+ version) in client_review, optional creative task advanced.
   */
  sendToPortal: staffProcedure
    .input(
      z.object({
        creativeGenerationId: z.string().uuid(),
        clientId: z.string().uuid(),
        title: z.string().min(1).max(180).optional(),
        advanceTask: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const employeeId = ctx.employeeId!;
      const gen = await loadGeneration(input.creativeGenerationId, employeeId);
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      if (gen.status !== "ready" || (!gen.imageUrl && !gen.imageB64)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Generation is not ready to send",
        });
      }

      const title =
        input.title?.trim() ||
        `Creative · ${gen.prompt.slice(0, 60)}`;

      let contentType = "image/png";
      let bytes: Uint8Array | null = null;
      if (gen.imageB64) {
        bytes = new Uint8Array(Buffer.from(gen.imageB64, "base64"));
        contentType = "image/svg+xml";
      } else if (gen.imageUrl?.startsWith("data:")) {
        const match = /^data:([^;,]+);base64,(.+)$/i.exec(gen.imageUrl);
        if (match) {
          contentType = match[1]!;
          bytes = new Uint8Array(Buffer.from(match[2]!, "base64"));
        }
      } else if (gen.imageUrl?.startsWith("http")) {
        try {
          const res = await fetch(gen.imageUrl);
          if (res.ok) {
            bytes = new Uint8Array(await res.arrayBuffer());
            contentType =
              res.headers.get("content-type")?.split(";")[0]?.trim() ||
              "image/png";
          }
        } catch {
          /* keep fallback path below */
        }
      }

      const db = getDb();
      if (!db) {
        const store = getDemoStore();
        let taskId = gen.taskId;
        if (input.advanceTask !== false) {
          const task = [...store.tasks.values()].find(
            (t) =>
              t.clientId === input.clientId && t.taskType === "social_cutdowns",
          );
          if (task) {
            task.status = "client_review";
            taskId = task.taskId;
          }
        }
        const asset = store.createAsset(
          title,
          input.clientId,
          taskId ?? null,
        );
        asset.status = "client_review";
        const ext =
          contentType.includes("svg")
            ? "svg"
            : contentType.includes("jpeg") || contentType.includes("jpg")
              ? "jpg"
              : "png";
        const storagePath = bytes
          ? `dam/${asset.assetId}/v1-creative.${ext}`
          : gen.imageUrl ??
            (gen.imageB64
              ? `data:image/svg+xml;base64,${gen.imageB64}`
              : `creative://${gen.creativeGenerationId}`);
        if (bytes) {
          const { getObjectStore } = await import("../storage/object-store");
          await getObjectStore().put({
            path: storagePath,
            body: bytes,
            contentType,
          });
        }
        asset.versions.push({
          assetVersionId: crypto.randomUUID(),
          assetId: asset.assetId,
          storagePath,
          versionNumber: 1,
          isClientRevision: false,
          uploadedByEmployeeId: employeeId,
          createdAt: new Date().toISOString(),
        });
        return {
          ok: true as const,
          assetId: asset.assetId,
          taskId,
          clientId: input.clientId,
          portalHref: "/portal/deliveries",
        };
      }

      let taskId = gen.taskId;
      if (input.advanceTask !== false) {
        const seeded = await seedClientCreativeTask({
          clientId: input.clientId,
          title: `Portal creative — ${title.slice(0, 80)}`,
          status: "qc",
        });
        if (seeded) {
          await updateDeliveryTaskStatus({
            taskId: seeded.taskId,
            status: "client_review",
            qcPassed: true,
            qcNotes: "Auto-QC for generated creative sent to portal",
          });
          taskId = seeded.taskId;
          await db.execute(sql`
            update public.creative_generation
            set task_id = ${seeded.taskId}::uuid
            where creative_generation_id = ${gen.creativeGenerationId}::uuid
          `);
        }
      }

      const assets = await db.execute<{ assetId: string }>(sql`
        insert into public.asset (title, client_id, status, task_id)
        values (
          ${title},
          ${input.clientId}::uuid,
          'client_review',
          ${taskId ?? null}::uuid
        )
        returning asset_id as "assetId"
      `);
      const assetId = assets[0]!.assetId;
      const ext =
        contentType.includes("svg")
          ? "svg"
          : contentType.includes("jpeg") || contentType.includes("jpg")
            ? "jpg"
            : "png";
      let storagePath = `dam/${assetId}/v1-creative.${ext}`;
      if (bytes) {
        const { getObjectStore } = await import("../storage/object-store");
        await getObjectStore().put({
          path: storagePath,
          body: bytes,
          contentType,
        });
      } else {
        storagePath =
          gen.imageUrl ??
          (gen.imageB64
            ? `data:image/svg+xml;base64,${gen.imageB64}`
            : `creative://${gen.creativeGenerationId}`);
      }
      await db.execute(sql`
        insert into public.asset_version (
          asset_id, storage_path, version_number, is_client_revision,
          uploaded_by_employee_id
        ) values (
          ${assetId}::uuid,
          ${storagePath},
          1,
          false,
          ${employeeId}::uuid
        )
      `);

      await db.execute(sql`
        update public.creative_generation
        set
          client_id = ${input.clientId}::uuid,
          metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({
            portalAssetId: assetId,
            sentToPortalAt: new Date().toISOString(),
            damUploaded: Boolean(bytes),
          })}::jsonb,
          updated_at = now()
        where creative_generation_id = ${gen.creativeGenerationId}::uuid
      `);

      await notifyEmployee({
        employeeId,
        title: "Creative sent to portal",
        body: title.slice(0, 120),
        kind: "creative",
        href: "/portal/deliveries",
        entityType: "asset",
        entityId: assetId,
      }).catch(() => undefined);

      return {
        ok: true as const,
        assetId,
        taskId,
        clientId: input.clientId,
        portalHref: "/portal/deliveries",
      };
    }),
});
