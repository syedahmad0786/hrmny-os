import { z } from "zod";
import {
  and,
  asset,
  assetVersion,
  auditEvent,
  convention,
  desc,
  eq,
  permissionPolicy,
  role,
  scheduledJob,
  sql,
} from "@hrmny/db";
import { randomUUID } from "node:crypto";
import { bootstrapGateRegistry } from "@hrmny/gate";
import { getDemoStore } from "../demo-store";
import { getDb } from "../db";
import { DEV_USERS, getAuthMode } from "../auth/session";
import {
  emitHealthSignal,
  listAudit,
  listHealthSignals,
  writeAudit,
} from "../m1-persistence";
import {
  createCallerFactory,
  protectedProcedure,
  publicProcedure,
  requirePermission,
  router,
} from "./trpc";
import {
  dashboardsHrRouter,
  employeesRouter,
  invoicesRouter,
  payrollRouter,
  requisitionsRouter,
} from "./m2-routers";
import {
  clientsRouter,
  dealsRouter,
  leadsRouter,
  outreachRouter,
  scopesRouter,
} from "./m3-routers";
import { crmRouter } from "./crm-routers";
import { ticketsRouter } from "./tickets-router";
import { automationRouter } from "./automation-router";
import { connectionsRouter } from "./connections-router";
import { featureRequestsRouter } from "./feature-requests-router";
import { coreHrRouter } from "./core-hr-router";
import { hrOperationsRouter } from "./hr-operations-router";
import { talentRouter } from "./talent-router";
import { payrollV2Router } from "./payroll-v2-router";
import { workplaceRouter } from "./workplace-router";
import { shiftsTimesheetsRouter } from "./shifts-timesheets-router";
import { benefitsReportingRouter } from "./benefits-reporting-router";
import { aiCustomAppsRouter } from "./ai-custom-apps-router";
import { digitalCardsRouter } from "./digital-cards-router";
import { clientPreviewRouter } from "./client-preview-router";
import { opsRouter } from "./ops-router";
import {
  briefsRouter as m4BriefsRouter,
  calendarsRouter as m4CalendarsRouter,
  deliveryDashboardsRouter,
  m4DemoRouter,
  tasksRouter as m4TasksRouter,
} from "./m4-routers";
import {
  m5DemoRouter,
  marginDashboardsRouter,
  vatRouter as m5VatRouter,
} from "./m5-routers";
import {
  dashboardsHubRouter,
  m6DemoRouter,
  portalRouter as m6PortalRouter,
  seamsRouter,
} from "./m6-routers";

bootstrapGateRegistry();

export const authRouter = router({
  session: publicProcedure.query(({ ctx }) => ({
    employeeId: ctx.employeeId,
    roles: ctx.roles,
    displayName: ctx.user?.displayName ?? "Anonymous",
    email: ctx.user?.email ?? null,
    canViewMargin: ctx.canViewMargin,
    actorType: ctx.user?.actorType ?? null,
    clientId: ctx.user?.clientId ?? null,
    authMode: getAuthMode(),
  })),
  /** Dev-only: list switchable personas for M1–M6 demo. */
  devUsers: publicProcedure.query(() =>
    getAuthMode() === "dev"
      ? Object.entries(DEV_USERS).map(([key, u]) => ({
          key,
          displayName: u.displayName,
          email: u.email,
          roles: u.roles,
          actorType: u.actorType,
          clientId: u.clientId,
        }))
      : [],
  ),
  logout: publicProcedure.mutation(() => undefined),
});

export const adminRouter = router({
  roles: router({
    list: protectedProcedure.query(async () => {
      const db = getDb();
      if (!db) return getDemoStore().roles;
      return db.select().from(role).orderBy(role.displayName);
    }),
  }),
  permissions: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = getDb();
      const policies = db
        ? await db
            .select({
              role: role.key,
              resource: permissionPolicy.resource,
              action: permissionPolicy.action,
              effect: permissionPolicy.effect,
            })
            .from(permissionPolicy)
            .innerJoin(role, eq(permissionPolicy.roleId, role.roleId))
        : [
            { role: "am", resource: "margin", action: "view", effect: "deny" },
            {
              role: "partner",
              resource: "margin",
              action: "view",
              effect: "allow",
            },
            {
              role: "finance",
              resource: "margin",
              action: "view",
              effect: "allow",
            },
            {
              role: "am",
              resource: "deal",
              action: "transition",
              effect: "allow",
            },
          ];
      return {
        policies,
        viewerCanSeeMargin: ctx.canViewMargin,
        viewerRoles: ctx.roles,
      };
    }),
  }),
  audit: router({
    list: protectedProcedure
      .use(requirePermission("audit", "view"))
      .input(
        z.object({ limit: z.number().min(1).max(100).optional() }).optional(),
      )
      .query(({ input }) => listAudit(input?.limit ?? 25)),
  }),
  health: router({
    get: protectedProcedure.query(async () => {
      const db = getDb();
      const [cap] = db
        ? await db
            .select({ payload: convention.payload })
            .from(convention)
            .where(
              and(
                eq(convention.ruleKey, "llm.spend_cap"),
                eq(convention.isActive, true),
              ),
            )
            .limit(1)
        : [];
      return {
        ok: true as const,
        signals: await listHealthSignals(10),
        spendCaps: {
          llmMonthlyAed:
            cap?.payload.monthlyAed ??
            (Number(process.env.LLM_MONTHLY_CAP_AED ?? 0) || null),
        },
        chatWebhookConfigured: Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL),
      };
    }),
    emitStub: protectedProcedure
      .input(
        z.object({
          signalKey: z.string(),
          severity: z.enum(["info", "warn", "critical"]).default("info"),
        }),
      )
      .mutation(async ({ input }) => {
        const row = await emitHealthSignal(input.signalKey, input.severity, {
          source: "admin.health.emitStub",
        });
        const webhookConfigured = Boolean(
          process.env.GOOGLE_CHAT_WEBHOOK_URL?.trim(),
        );
        return {
          ...row,
          chat:
            webhookConfigured && row.notifiedAt
              ? ("posted" as const)
              : ("stubbed" as const),
          webhookConfigured,
        };
      }),
  }),
  jobs: router({
    list: protectedProcedure.query(async () => {
      const db = getDb();
      if (!db) return [];
      return db
        .select()
        .from(scheduledJob)
        .orderBy(desc(scheduledJob.createdAt))
        .limit(20);
    }),
    scheduleHealth: protectedProcedure
      .input(
        z.object({
          delayMinutes: z.number().int().min(1).max(10_080),
          signalKey: z.string().min(1).max(120),
          severity: z.enum(["info", "warn", "critical"]).default("info"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        if (!db) throw new Error("DATABASE_URL is required for scheduled jobs");
        const runAt = new Date(Date.now() + input.delayMinutes * 60_000);
        return db.transaction(async (tx) => {
          const [job] = await tx
            .insert(scheduledJob)
            .values({
              jobKey: randomUUID(),
              kind: "health_signal",
              runAt,
              payload: {
                signalKey: input.signalKey,
                severity: input.severity,
                payload: { source: "admin.jobs.scheduleHealth" },
              },
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "scheduledJob.create",
            entityType: "scheduled_job",
            entityId: job!.scheduledJobId,
            after: { kind: job!.kind, runAt: runAt.toISOString() },
          });
          return job!;
        });
      }),
  }),
});

export const conventionsRouter = router({
  list: protectedProcedure
    .input(z.object({ ruleKey: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      if (db) {
        return db
          .select()
          .from(convention)
          .where(
            input?.ruleKey
              ? and(
                  eq(convention.isActive, true),
                  eq(convention.ruleKey, input.ruleKey),
                )
              : eq(convention.isActive, true),
          )
          .orderBy(convention.ruleKey);
      }
      const rows = [...getDemoStore().conventions.values()];
      if (input?.ruleKey)
        return rows.filter((r) => r.ruleKey === input.ruleKey);
      return rows.sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
    }),
  upsert: protectedProcedure
    .use(requirePermission("convention", "edit"))
    .input(
      z.object({
        ruleKey: z.string().min(1),
        payload: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (db) {
        return db.transaction(async (tx) => {
          const [previous] = await tx
            .select()
            .from(convention)
            .where(eq(convention.ruleKey, input.ruleKey))
            .orderBy(desc(convention.version))
            .limit(1);
          await tx
            .update(convention)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(convention.ruleKey, input.ruleKey),
                eq(convention.isActive, true),
              ),
            );
          const [next] = await tx
            .insert(convention)
            .values({
              ruleKey: input.ruleKey,
              version: String(Number(previous?.version ?? 0) + 1),
              payload: input.payload,
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "convention.upsert",
            entityType: "convention",
            entityId: next!.conventionId,
            before: previous
              ? { version: previous.version, payload: previous.payload }
              : null,
            after: { version: next!.version, payload: next!.payload },
          });
          return next!;
        });
      }
      const store = getDemoStore();
      const prev = store.conventions.get(input.ruleKey);
      const next = {
        ruleKey: input.ruleKey,
        version: (prev?.version ?? 0) + 1,
        payload: input.payload,
        updatedAt: new Date().toISOString(),
        updatedByEmployeeId: ctx.employeeId,
      };
      store.conventions.set(input.ruleKey, next);
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "convention.upsert",
        entityType: "convention",
        entityId: "00000000-0000-4000-8000-000000000000",
        before: prev ? { ...prev } : null,
        after: { ...next },
        reason: null,
      });
      return next;
    }),
});

export const assetsRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        clientId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (db) {
        return db.transaction(async (tx) => {
          const [created] = await tx
            .insert(asset)
            .values({
              title: input.title,
              clientId: input.clientId ?? null,
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "assets.create",
            entityType: "asset",
            entityId: created!.assetId,
            after: { title: created!.title, clientId: created!.clientId },
          });
          return { ...created!, versions: [] };
        });
      }
      const demoAsset = getDemoStore().createAsset(
        input.title,
        input.clientId ?? null,
      );
      return demoAsset;
    }),
  uploadVersion: protectedProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        fileName: z.string().min(1).max(180),
        contentType: z.string().default("application/octet-stream"),
        contentBase64: z.string().min(1).max(15_000_000),
        isClientRevision: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (db) {
        const [existing] = await db
          .select({ assetId: asset.assetId })
          .from(asset)
          .where(eq(asset.assetId, input.assetId))
          .limit(1);
        if (!existing) throw new Error("NOT_FOUND");
        const [latest] = await db
          .select({
            version: sql<number>`coalesce(max(${assetVersion.versionNumber}), 0)::int`,
          })
          .from(assetVersion)
          .where(eq(assetVersion.assetId, input.assetId));
        const versionNumber = Number(latest?.version ?? 0) + 1;
        const fileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
        const storagePath = `dam/${input.assetId}/v${versionNumber}-${fileName}`;
        const raw = Buffer.from(input.contentBase64, "base64");
        if (raw.byteLength > 10_000_000) {
          throw new Error("Asset versions are limited to 10 MB");
        }
        await getDemoStore().objectStore.put({
          path: storagePath,
          body: new Uint8Array(raw),
          contentType: input.contentType,
        });
        let version: typeof assetVersion.$inferSelect;
        try {
          version = await db.transaction(async (tx) => {
            const [created] = await tx
              .insert(assetVersion)
              .values({
                assetId: input.assetId,
                storagePath,
                versionNumber: String(versionNumber),
                isClientRevision: input.isClientRevision ?? false,
                uploadedByEmployeeId: ctx.employeeId,
              })
              .returning();
            await tx.insert(auditEvent).values({
              actorEmployeeId: ctx.employeeId,
              action: "assets.uploadVersion",
              entityType: "asset",
              entityId: input.assetId,
              after: {
                assetVersionId: created!.assetVersionId,
                storagePath,
                versionNumber,
              },
            });
            return created!;
          });
        } catch (error) {
          await getDemoStore().objectStore.remove?.(storagePath);
          throw error;
        }
        await emitHealthSignal("dam_upload", "info", {
          assetId: input.assetId,
          versionNumber,
        });
        return { ...version, versionNumber };
      }
      const version = await getDemoStore().uploadVersion({
        assetId: input.assetId,
        contentBase64: input.contentBase64,
        contentType: input.contentType,
        fileName: input.fileName,
        employeeId: ctx.employeeId,
        isClientRevision: input.isClientRevision,
      });
      getDemoStore().pushHealth("dam_upload", "info", {
        assetId: input.assetId,
        versionNumber: version.versionNumber,
      });
      return version;
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      if (!db) return getDemoStore().assets.get(input.id) ?? null;
      const [row] = await db
        .select()
        .from(asset)
        .where(eq(asset.assetId, input.id))
        .limit(1);
      if (!row) return null;
      const versions = await db
        .select()
        .from(assetVersion)
        .where(eq(assetVersion.assetId, input.id))
        .orderBy(assetVersion.versionNumber);
      return {
        ...row,
        versions: versions.map((version) => ({
          ...version,
          versionNumber: Number(version.versionNumber),
        })),
      };
    }),
  signedUrl: protectedProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        versionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      if (db) {
        const [version] = await db
          .select()
          .from(assetVersion)
          .where(
            and(
              eq(assetVersion.assetId, input.assetId),
              eq(assetVersion.assetVersionId, input.versionId),
            ),
          )
          .limit(1);
        if (!version) return null;
        const ttl = Number(process.env.DAM_SIGNED_URL_TTL_SECONDS ?? 300);
        const signed = await getDemoStore().objectStore.signedUrl(
          version.storagePath,
          ttl,
        );
        await writeAudit({
          actorEmployeeId: ctx.employeeId,
          action: "assets.signedUrl",
          entityType: "asset_version",
          entityId: version.assetVersionId,
          before: null,
          after: { path: version.storagePath, expiresAt: signed.expiresAt },
          reason: null,
        });
        return signed;
      }
      const asset = getDemoStore().assets.get(input.assetId);
      if (!asset) return null;
      const version = asset.versions.find(
        (v) => v.assetVersionId === input.versionId,
      );
      if (!version) return null;
      const ttl = Number(process.env.DAM_SIGNED_URL_TTL_SECONDS ?? 300);
      const signed = await getDemoStore().objectStore.signedUrl(
        version.storagePath,
        ttl,
      );
      getDemoStore().appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "assets.signedUrl",
        entityType: "asset_version",
        entityId: version.assetVersionId,
        before: null,
        after: { path: version.storagePath, expiresAt: signed.expiresAt },
        reason: null,
      });
      return signed;
    }),
  list: protectedProcedure.query(async () => {
    const db = getDb();
    if (!db) return [...getDemoStore().assets.values()];
    const [assets, versions] = await Promise.all([
      db.select().from(asset).orderBy(desc(asset.createdAt)),
      db.select().from(assetVersion).orderBy(assetVersion.versionNumber),
    ]);
    return assets.map((row) => ({
      ...row,
      versions: versions
        .filter((version) => version.assetId === row.assetId)
        .map((version) => ({
          ...version,
          versionNumber: Number(version.versionNumber),
        })),
    }));
  }),
  qc: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(["pass", "fail", "waive"]),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const isCd =
        ctx.roles.includes("creative_director") ||
        ctx.roles.includes("partner") ||
        ctx.roles.includes("director");
      if (!isCd) {
        return {
          ok: false as const,
          code: "GATE_BLOCKED" as const,
          reason: "Only Creative Director may QC assets",
        };
      }
      const db = getDb();
      if (db) {
        return db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(asset)
            .where(eq(asset.assetId, input.id))
            .limit(1);
          if (!existing) throw new Error("NOT_FOUND");
          const [latest] = await tx
            .select({ assetVersionId: assetVersion.assetVersionId })
            .from(assetVersion)
            .where(eq(assetVersion.assetId, input.id))
            .orderBy(desc(assetVersion.createdAt))
            .limit(1);
          const qcPassed =
            input.decision === "pass" || input.decision === "waive";
          const [updated] = await tx
            .update(asset)
            .set({
              status:
                input.decision === "fail" ? "internal_review" : "qc_passed",
              approvedVersionId: qcPassed
                ? (latest?.assetVersionId ?? null)
                : null,
              updatedAt: new Date(),
            })
            .where(eq(asset.assetId, input.id))
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: ctx.employeeId,
            action: "assets.qc",
            entityType: "asset",
            entityId: input.id,
            before: {
              status: existing.status,
              approvedVersionId: existing.approvedVersionId,
            },
            after: {
              decision: input.decision,
              qcPassed,
              status: updated!.status,
              approvedVersionId: updated!.approvedVersionId,
            },
            reason: input.notes ?? null,
          });
          return { ok: true as const, asset: updated! };
        });
      }
      const store = getDemoStore();
      const demoAsset = store.assets.get(input.id);
      if (!demoAsset) throw new Error("NOT_FOUND");
      demoAsset.qcPassed =
        input.decision === "pass" || input.decision === "waive";
      demoAsset.status =
        input.decision === "fail"
          ? "internal_review"
          : input.decision === "pass" || input.decision === "waive"
            ? "qc_passed"
            : demoAsset.status;
      if (demoAsset.taskId) {
        const task = store.tasks.get(demoAsset.taskId);
        if (task) {
          task.qcPassed = demoAsset.qcPassed;
          if (demoAsset.qcPassed) task.status = "qc";
        }
      }
      store.appendAudit({
        actorEmployeeId: ctx.employeeId!,
        action: "assets.qc",
        entityType: "asset",
        entityId: demoAsset.assetId,
        before: null,
        after: { decision: input.decision, qcPassed: demoAsset.qcPassed },
        reason: input.notes ?? null,
      });
      return { ok: true as const, asset: demoAsset };
    }),
});

export {
  dealsRouter,
  scopesRouter,
  clientsRouter,
  outreachRouter,
  leadsRouter,
};

export const calendarsRouter = m4CalendarsRouter;
export const briefsRouter = m4BriefsRouter;
export const tasksRouter = m4TasksRouter;

export const dashboardsRouter = router({
  capacity: deliveryDashboardsRouter.capacity,
  delivery: deliveryDashboardsRouter.delivery,
  hrLifecycle: dashboardsHrRouter.hrLifecycle,
  margin: marginDashboardsRouter,
  hub: dashboardsHubRouter.hub,
});

export { invoicesRouter, payrollRouter, employeesRouter, requisitionsRouter };

export const vatRouter = m5VatRouter;

export const portalRouter = m6PortalRouter;

export const appRouter = router({
  auth: authRouter,
  admin: adminRouter,
  conventions: conventionsRouter,
  connections: connectionsRouter,
  featureRequests: featureRequestsRouter,
  coreHr: coreHrRouter,
  hrOperations: hrOperationsRouter,
  talent: talentRouter,
  workforcePayroll: payrollV2Router,
  workplace: workplaceRouter,
  shiftsTimesheets: shiftsTimesheetsRouter,
  benefits: benefitsReportingRouter,
  aiCustomApps: aiCustomAppsRouter,
  digitalCards: digitalCardsRouter,
  clientPreview: clientPreviewRouter,
  assets: assetsRouter,
  /** Legacy M3 demo-store deals (gates, BUAF, HITL). Prefer `crm.*` for durable CRM. */
  deals: dealsRouter,
  /** Durable CRM: companies, contacts, deals, activities, notes, tasks → Postgres or memory. */
  crm: crmRouter,
  /** Support tickets (team + portal requester) — memory stub until 0004_tickets applied. */
  tickets: ticketsRouter,
  /** n8n automation — health / list / propose / HITL trigger (automation-orchestrator). */
  automation: automationRouter,
  scopes: scopesRouter,
  clients: clientsRouter,
  calendars: calendarsRouter,
  briefs: briefsRouter,
  tasks: tasksRouter,
  dashboards: dashboardsRouter,
  invoices: invoicesRouter,
  payroll: payrollRouter,
  vat: vatRouter,
  employees: employeesRouter,
  requisitions: requisitionsRouter,
  outreach: outreachRouter,
  leads: leadsRouter,
  portal: portalRouter,
  seams: seamsRouter,
  m4: m4DemoRouter,
  m5: m5DemoRouter,
  m6: m6DemoRouter,
  ops: opsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
