import { randomUUID } from "node:crypto";
import {
  desc,
  eq,
  reportRuns,
  reportSchedules,
  type Db,
} from "@hrmny/db";
import { getDb } from "../db";
import { isDue } from "./types";

/**
 * Report schedules + runs durable layer. Postgres over report_schedules /
 * report_runs when DATABASE_URL is set, else a module-level in-memory store —
 * same withDb(fn, fallback) shape as campaigns/repository.ts, so the scheduler
 * is fully exercisable in CI with no DB.
 */

export type ScheduleRow = {
  reportScheduleId: string;
  reportKey: string;
  cadence: string;
  recipients: string[];
  enabled: boolean;
  lastRunAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunStatus = "pending" | "sent" | "failed";

export type RunRow = {
  reportRunId: string;
  reportScheduleId: string | null;
  reportKey: string;
  status: RunStatus;
  artifact: Record<string, unknown>;
  createdAt: string;
};

type Memory = {
  schedules: Map<string, ScheduleRow>;
  runs: Map<string, RunRow>;
};

let memory: Memory | null = null;
function mem(): Memory {
  if (!memory) memory = { schedules: new Map(), runs: new Map() };
  return memory;
}
/** Test hook — clears the in-memory store. */
export function resetReportStore(): void {
  memory = null;
}

async function withDb<T>(
  fn: (db: Db) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const db = getDb();
  return db ? fn(db) : fallback();
}

const iso = (d: Date | string | null | undefined): string =>
  d == null ? new Date().toISOString() : d instanceof Date ? d.toISOString() : d;

function mapSchedule(r: typeof reportSchedules.$inferSelect): ScheduleRow {
  return {
    reportScheduleId: r.reportScheduleId,
    reportKey: r.reportKey,
    cadence: r.cadence,
    recipients: r.recipients ?? [],
    enabled: r.enabled,
    lastRunAt: r.lastRunAt ? iso(r.lastRunAt) : null,
    createdBy: r.createdBy ?? null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function mapRun(r: typeof reportRuns.$inferSelect): RunRow {
  return {
    reportRunId: r.reportRunId,
    reportScheduleId: r.reportScheduleId ?? null,
    reportKey: r.reportKey,
    status: r.status as RunStatus,
    artifact: (r.artifact ?? {}) as Record<string, unknown>,
    createdAt: iso(r.createdAt),
  };
}

// ── schedules CRUD ───────────────────────────────────────────

export async function listSchedules(): Promise<ScheduleRow[]> {
  return withDb(
    async (db) =>
      (
        await db
          .select()
          .from(reportSchedules)
          .orderBy(desc(reportSchedules.createdAt))
      ).map(mapSchedule),
    () =>
      [...mem().schedules.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
  );
}

export async function getSchedule(id: string): Promise<ScheduleRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(reportSchedules)
        .where(eq(reportSchedules.reportScheduleId, id))
        .limit(1);
      return row ? mapSchedule(row) : null;
    },
    () => mem().schedules.get(id) ?? null,
  );
}

export async function createSchedule(input: {
  reportKey: string;
  cadence: string;
  recipients: string[];
  enabled?: boolean;
  createdBy?: string | null;
}): Promise<ScheduleRow> {
  return withDb(
    async (db) => {
      const [row] = await db
        .insert(reportSchedules)
        .values({
          reportKey: input.reportKey,
          cadence: input.cadence,
          recipients: input.recipients,
          enabled: input.enabled ?? true,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return mapSchedule(row!);
    },
    () => {
      const t = new Date().toISOString();
      const row: ScheduleRow = {
        reportScheduleId: randomUUID(),
        reportKey: input.reportKey,
        cadence: input.cadence,
        recipients: input.recipients,
        enabled: input.enabled ?? true,
        lastRunAt: null,
        createdBy: input.createdBy ?? null,
        createdAt: t,
        updatedAt: t,
      };
      mem().schedules.set(row.reportScheduleId, row);
      return row;
    },
  );
}

export async function updateSchedule(
  id: string,
  patch: Partial<
    Pick<ScheduleRow, "cadence" | "recipients" | "enabled" | "reportKey">
  >,
): Promise<ScheduleRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .update(reportSchedules)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(reportSchedules.reportScheduleId, id))
        .returning();
      return row ? mapSchedule(row) : null;
    },
    () => {
      const existing = mem().schedules.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      mem().schedules.set(id, next);
      return next;
    },
  );
}

export async function deleteSchedule(id: string): Promise<boolean> {
  return withDb(
    async (db) => {
      const rows = await db
        .delete(reportSchedules)
        .where(eq(reportSchedules.reportScheduleId, id))
        .returning();
      return rows.length > 0;
    },
    () => mem().schedules.delete(id),
  );
}

/** Advance last_run_at after a run so the next tick sees the schedule as not-due. */
export async function markRan(id: string, at: Date): Promise<void> {
  await withDb(
    async (db) => {
      await db
        .update(reportSchedules)
        .set({ lastRunAt: at, updatedAt: at })
        .where(eq(reportSchedules.reportScheduleId, id));
    },
    () => {
      const existing = mem().schedules.get(id);
      if (existing)
        mem().schedules.set(id, {
          ...existing,
          lastRunAt: at.toISOString(),
          updatedAt: at.toISOString(),
        });
    },
  );
}

/** Enabled schedules whose cadence interval has elapsed (see isDue). */
export async function dueSchedules(now: Date): Promise<ScheduleRow[]> {
  return (await listSchedules()).filter((s) => isDue(s, now));
}

// ── runs ─────────────────────────────────────────────────────

export async function recordRun(input: {
  reportScheduleId: string | null;
  reportKey: string;
  status: RunStatus;
  artifact: Record<string, unknown>;
}): Promise<RunRow> {
  return withDb(
    async (db) => {
      const [row] = await db.insert(reportRuns).values(input).returning();
      return mapRun(row!);
    },
    () => {
      const row: RunRow = {
        reportRunId: randomUUID(),
        reportScheduleId: input.reportScheduleId,
        reportKey: input.reportKey,
        status: input.status,
        artifact: input.artifact,
        createdAt: new Date().toISOString(),
      };
      mem().runs.set(row.reportRunId, row);
      return row;
    },
  );
}

export async function listRuns(scheduleId?: string): Promise<RunRow[]> {
  return withDb(
    async (db) => {
      const rows = scheduleId
        ? await db
            .select()
            .from(reportRuns)
            .where(eq(reportRuns.reportScheduleId, scheduleId))
            .orderBy(desc(reportRuns.createdAt))
        : await db
            .select()
            .from(reportRuns)
            .orderBy(desc(reportRuns.createdAt));
      return rows.map(mapRun);
    },
    () => {
      let rows = [...mem().runs.values()];
      if (scheduleId)
        rows = rows.filter((r) => r.reportScheduleId === scheduleId);
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );
}

export async function getRun(id: string): Promise<RunRow | null> {
  return withDb(
    async (db) => {
      const [row] = await db
        .select()
        .from(reportRuns)
        .where(eq(reportRuns.reportRunId, id))
        .limit(1);
      return row ? mapRun(row) : null;
    },
    () => mem().runs.get(id) ?? null,
  );
}
