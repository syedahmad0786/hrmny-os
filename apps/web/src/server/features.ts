import { auditEvent, sql } from "@hrmny/db";
import {
  FEATURE_BY_KEY,
  FEATURE_CATALOG,
  type FeatureDefinition,
} from "@/features/catalog";
import { getDb } from "./db";
import { getDemoStore } from "./demo-store";

export type FeatureScope = "global" | "client" | "role" | "user";

export type FeatureOverride = {
  featureOverrideId: string;
  featureKey: string;
  scopeType: FeatureScope;
  scopeKey: string;
  enabled: boolean;
  reason: string | null;
  updatedByEmployeeId: string | null;
  updatedAt: string;
};

export type FeatureSubject = {
  userId?: string | null;
  clientId?: string | null;
  roles?: readonly string[];
};

export type ResolvedFeature = FeatureDefinition & {
  enabled: boolean;
  reason:
    "protected" | "planned" | "default" | "global" | "client" | "role" | "user";
};

const demoOverrides = new Map<string, FeatureOverride>();
let overrideListInFlight: Promise<FeatureOverride[]> | null = null;

function overrideKey(
  featureKey: string,
  scopeType: FeatureScope,
  scopeKey: string,
) {
  return `${featureKey}\u0000${scopeType}\u0000${scopeKey}`;
}

function findOverride(
  overrides: readonly FeatureOverride[],
  featureKey: string,
  scopeType: FeatureScope,
  scopeKey: string,
) {
  return overrides.find(
    (item) =>
      item.featureKey === featureKey &&
      item.scopeType === scopeType &&
      item.scopeKey === scopeKey,
  );
}

/** Global/client false are hard boundaries; a user exception may override roles. */
export function resolveFeature(
  definition: FeatureDefinition,
  overrides: readonly FeatureOverride[],
  subject: FeatureSubject = {},
): ResolvedFeature {
  if (definition.protected) {
    return { ...definition, enabled: true, reason: "protected" };
  }
  if (definition.availability === "planned") {
    return { ...definition, enabled: false, reason: "planned" };
  }

  let enabled = definition.defaultEnabled;
  let reason: ResolvedFeature["reason"] = "default";
  const global = findOverride(overrides, definition.key, "global", "global");
  if (global) {
    enabled = global.enabled;
    reason = "global";
    if (!enabled) return { ...definition, enabled, reason };
  }

  if (subject.clientId) {
    const client = findOverride(
      overrides,
      definition.key,
      "client",
      subject.clientId,
    );
    if (client) {
      enabled = client.enabled;
      reason = "client";
      if (!enabled) return { ...definition, enabled, reason };
    }
  }

  if (subject.userId) {
    const user = findOverride(
      overrides,
      definition.key,
      "user",
      subject.userId,
    );
    if (user) {
      return { ...definition, enabled: user.enabled, reason: "user" };
    }
  }

  const roleOverrides = (subject.roles ?? []).flatMap((role) => {
    const match = findOverride(overrides, definition.key, "role", role);
    return match ? [match] : [];
  });
  if (roleOverrides.some((item) => !item.enabled)) {
    return { ...definition, enabled: false, reason: "role" };
  }
  if (roleOverrides.some((item) => item.enabled)) {
    return { ...definition, enabled: true, reason: "role" };
  }

  return { ...definition, enabled, reason };
}

export function resolveFeatureCatalog(
  overrides: readonly FeatureOverride[],
  subject: FeatureSubject = {},
) {
  return FEATURE_CATALOG.map((definition) =>
    resolveFeature(definition, overrides, subject),
  );
}

type FeatureOverrideRow = {
  feature_override_id: string;
  feature_key: string;
  scope_type: FeatureScope;
  scope_key: string;
  enabled: boolean;
  reason: string | null;
  updated_by_employee_id: string | null;
  updated_at: Date | string;
};

function mapOverride(row: FeatureOverrideRow): FeatureOverride {
  return {
    featureOverrideId: row.feature_override_id,
    featureKey: row.feature_key,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    enabled: row.enabled,
    reason: row.reason,
    updatedByEmployeeId: row.updated_by_employee_id,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };
}

export async function listFeatureOverrides(): Promise<FeatureOverride[]> {
  const db = getDb();
  if (!db) return [...demoOverrides.values()];
  const current = (overrideListInFlight ??= db
    .execute<FeatureOverrideRow>(
      sql`
          select feature_override_id, feature_key, scope_type, scope_key,
            enabled, reason, updated_by_employee_id, updated_at
          from public.feature_override
          order by feature_key, scope_type, scope_key
        `,
    )
    .then((rows) => rows.map(mapOverride)));
  try {
    return await current;
  } finally {
    if (overrideListInFlight === current) overrideListInFlight = null;
  }
}

function auditSnapshot(row: FeatureOverride | null) {
  return row
    ? {
        featureKey: row.featureKey,
        scopeType: row.scopeType,
        scopeKey: row.scopeKey,
        enabled: row.enabled,
      }
    : null;
}

export async function setFeatureOverride(input: {
  featureKey: string;
  scopeType: FeatureScope;
  scopeKey: string;
  enabled: boolean;
  reason?: string | null;
  updatedByEmployeeId: string;
}): Promise<FeatureOverride> {
  const definition = FEATURE_BY_KEY.get(input.featureKey);
  if (!definition) throw new Error("Unknown feature");
  if (definition.protected)
    throw new Error("Protected features cannot be disabled");
  if (definition.availability === "planned") {
    throw new Error(
      "Planned features cannot be enabled until they are shipped",
    );
  }

  const db = getDb();
  if (!db) {
    const key = overrideKey(input.featureKey, input.scopeType, input.scopeKey);
    const current = demoOverrides.get(key);
    const row: FeatureOverride = {
      featureOverrideId: current?.featureOverrideId ?? crypto.randomUUID(),
      featureKey: input.featureKey,
      scopeType: input.scopeType,
      scopeKey: input.scopeKey,
      enabled: input.enabled,
      reason: input.reason ?? null,
      updatedByEmployeeId: input.updatedByEmployeeId,
      updatedAt: new Date().toISOString(),
    };
    demoOverrides.set(key, row);
    getDemoStore().appendAudit({
      actorEmployeeId: input.updatedByEmployeeId,
      action: "feature_override.upsert",
      entityType: "feature_override",
      entityId: row.featureOverrideId,
      before: auditSnapshot(current ?? null),
      after: auditSnapshot(row),
      reason: input.reason ?? null,
    });
    return row;
  }

  return db.transaction(async (tx) => {
    const beforeRows = await tx.execute<FeatureOverrideRow>(sql`
      select feature_override_id, feature_key, scope_type, scope_key,
        enabled, reason, updated_by_employee_id, updated_at
      from public.feature_override
      where feature_key = ${input.featureKey}
        and scope_type = ${input.scopeType}
        and scope_key = ${input.scopeKey}
      limit 1
    `);
    const rows = await tx.execute<FeatureOverrideRow>(sql`
      insert into public.feature_override (
        feature_key, scope_type, scope_key, enabled, reason,
        updated_by_employee_id
      ) values (
        ${input.featureKey}, ${input.scopeType}, ${input.scopeKey},
        ${input.enabled}, ${input.reason ?? null},
        ${input.updatedByEmployeeId}::uuid
      )
      on conflict (feature_key, scope_type, scope_key)
      do update set enabled = excluded.enabled, reason = excluded.reason,
        updated_by_employee_id = excluded.updated_by_employee_id,
        updated_at = now()
      returning feature_override_id, feature_key, scope_type, scope_key,
        enabled, reason, updated_by_employee_id, updated_at
    `);
    const saved = mapOverride(rows[0]!);
    await tx.insert(auditEvent).values({
      actorEmployeeId: input.updatedByEmployeeId,
      action: "feature_override.upsert",
      entityType: "feature_override",
      entityId: saved.featureOverrideId,
      before: beforeRows[0] ? auditSnapshot(mapOverride(beforeRows[0])) : null,
      after: auditSnapshot(saved),
      reason: input.reason ?? null,
    });
    return saved;
  });
}

export async function removeFeatureOverride(input: {
  featureKey: string;
  scopeType: FeatureScope;
  scopeKey: string;
  updatedByEmployeeId: string;
  reason?: string | null;
}) {
  const db = getDb();
  if (!db) {
    const key = overrideKey(input.featureKey, input.scopeType, input.scopeKey);
    const existing = demoOverrides.get(key) ?? null;
    demoOverrides.delete(key);
    getDemoStore().appendAudit({
      actorEmployeeId: input.updatedByEmployeeId,
      action: "feature_override.remove",
      entityType: "feature_override",
      entityId: existing?.featureOverrideId ?? crypto.randomUUID(),
      before: auditSnapshot(existing),
      after: null,
      reason: input.reason ?? "Return to inherited access",
    });
    return;
  }
  await db.transaction(async (tx) => {
    const rows = await tx.execute<FeatureOverrideRow>(sql`
      select feature_override_id, feature_key, scope_type, scope_key,
        enabled, reason, updated_by_employee_id, updated_at
      from public.feature_override
      where feature_key = ${input.featureKey}
        and scope_type = ${input.scopeType}
        and scope_key = ${input.scopeKey}
      limit 1
    `);
    const existing = rows[0] ? mapOverride(rows[0]) : null;
    await tx.execute(sql`
      delete from public.feature_override
      where feature_key = ${input.featureKey}
        and scope_type = ${input.scopeType}
        and scope_key = ${input.scopeKey}
    `);
    await tx.insert(auditEvent).values({
      actorEmployeeId: input.updatedByEmployeeId,
      action: "feature_override.remove",
      entityType: "feature_override",
      entityId: existing?.featureOverrideId ?? null,
      before: auditSnapshot(existing),
      after: null,
      reason: input.reason ?? "Return to inherited access",
    });
  });
}

export async function featureEnabled(
  featureKey: string,
  subject: FeatureSubject,
): Promise<boolean> {
  const definition = FEATURE_BY_KEY.get(featureKey);
  if (!definition) return false;
  return resolveFeature(definition, await listFeatureOverrides(), subject)
    .enabled;
}

export function clearDemoFeatureOverrides() {
  demoOverrides.clear();
}
