import { z } from "zod";
import { writeAudit } from "../m1-persistence";
import {
  SCORECARD_ENTITY_KINDS,
  type ScorecardEntityKind,
} from "../scorecards/engine";
import {
  getDefinition,
  getSnapshot,
  listDefinitions,
  listOverrides,
  listSnapshots,
  overrideSnapshot,
  saveDefinition,
  scoreDealFromBuaf,
  setDefinitionActive,
  type StoredSnapshot,
} from "../scorecards/store";
import {
  requirePermission,
  router,
  staffProcedure,
  type TrpcContext,
} from "./trpc";

/**
 * Explainable ratings tRPC surface — importable module. The orchestrator wires
 * this onto appRouter (NOT registered in root.ts here). Reads are staff-level;
 * definition mutations are admin-gated (allow:admin:features, the same gate
 * feature-lab/asana-migration use); overrides are audited via writeAudit.
 *
 * Score visibility (PLAN-PRODUCTION): "Score visibility must inherit the
 * permissions of its underlying evidence." v1 limitation — full per-evidence
 * inheritance is deep (each factor ref would resolve its own resource ACL).
 * filterSnapshotForViewer() is the seam; today it returns the snapshot intact
 * for any staff viewer. Wire real evidence-ACL resolution here when the
 * evidence registry lands; the router already routes every read through it.
 */

const adminProcedure = staffProcedure.use(
  requirePermission("admin", "features"),
);

/** v1: identity passthrough. See module note — the seam for evidence-ACL inheritance. */
function filterSnapshotForViewer(
  snapshot: StoredSnapshot,
  _ctx: TrpcContext,
): StoredSnapshot {
  return snapshot;
}

const FactorSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  weight: z.number().min(0).max(1),
});

const definitionsRouter = router({
  list: staffProcedure
    .input(
      z
        .object({ key: z.string().optional(), activeOnly: z.boolean().optional() })
        .optional(),
    )
    .query(({ input }) => listDefinitions(input)),

  get: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getDefinition(input.id)),

  /** Create or version-bump a definition. saveDefinition validates weights sum to 1. */
  save: adminProcedure
    .input(
      z.object({
        key: z.string().min(1),
        entityKind: z.enum(SCORECARD_ENTITY_KINDS),
        weights: z.array(FactorSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const def = await saveDefinition(input);
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "scorecard.definition.saved",
        entityType: "scorecard_definition",
        entityId: def.scorecardDefinitionId,
        before: null,
        after: { key: def.key, version: def.version },
        reason: null,
      });
      return def;
    }),

  setActive: adminProcedure
    .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const def = await setDefinitionActive(input.id, input.active);
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: input.active
          ? "scorecard.definition.activated"
          : "scorecard.definition.deactivated",
        entityType: "scorecard_definition",
        entityId: input.id,
        before: null,
        after: { active: input.active },
        reason: null,
      });
      return def;
    }),
});

const snapshotsRouter = router({
  get: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const snap = await getSnapshot(input.id);
      return snap ? filterSnapshotForViewer(snap, ctx) : null;
    }),

  list: staffProcedure
    .input(
      z.object({
        entityKind: z.enum(SCORECARD_ENTITY_KINDS),
        entityId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await listSnapshots(input);
      return rows.map((s) => filterSnapshotForViewer(s, ctx));
    }),

  overrides: staffProcedure
    .input(z.object({ snapshotId: z.string().uuid() }))
    .query(({ input }) => listOverrides(input.snapshotId)),

  /**
   * Recompute an entity's score from fresh evidence. v1 has one evidence
   * collector: deal → BUAF. Other kinds return an explicit "not wired yet"
   * rather than a silent empty score — the collector seam per kind is future work.
   */
  recompute: staffProcedure
    .input(
      z.object({
        entityKind: z.enum(SCORECARD_ENTITY_KINDS),
        entityId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const snap = await recomputeEntity(input.entityKind, input.entityId);
      return filterSnapshotForViewer(snap, ctx);
    }),

  /** Justified human correction. Reason is required; the row is audited. */
  override: staffProcedure
    .input(
      z.object({
        snapshotId: z.string().uuid(),
        newScore: z.number().int().min(0).max(100),
        reason: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await getSnapshot(input.snapshotId);
      const override = await overrideSnapshot({
        snapshotId: input.snapshotId,
        actor: ctx.employeeId ?? "system",
        reason: input.reason,
        newScore: input.newScore,
      });
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "scorecard.snapshot.overridden",
        entityType: "scorecard_snapshot",
        entityId: input.snapshotId,
        before: before ? { score: before.score } : null,
        after: { newScore: input.newScore },
        reason: input.reason,
      });
      return override;
    }),
});

async function recomputeEntity(
  entityKind: ScorecardEntityKind,
  entityId: string,
): Promise<StoredSnapshot> {
  if (entityKind === "deal") {
    return scoreDealFromBuaf({ dealId: entityId });
  }
  throw new Error(
    `No evidence collector wired for entity kind "${entityKind}" yet`,
  );
}

export const scorecardsRouter = router({
  definitions: definitionsRouter,
  snapshots: snapshotsRouter,
});
