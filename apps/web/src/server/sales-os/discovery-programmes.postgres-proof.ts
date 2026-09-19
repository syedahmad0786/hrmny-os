import { randomUUID } from "node:crypto";
import { createDb, sql } from "@hrmny/db";
import { expect, it } from "vitest";
import { disconnectGovernedApiKeyConnection } from "../integrations/governed-api-key";
import {
  createDiscoveryProgramme,
  DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
  defaultDiscoverySources,
  getDiscoveryProgramme,
  publishDiscoveryProgramme,
  saveDiscoveryProgrammeDraft,
  type DiscoverySourceDraft,
} from "./discovery-programmes";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("LOCAL_POSTGRES_PROOF_REQUIRED");

const db = createDb(databaseUrl);
const ownerId = randomUUID();
const reviewerId = randomUUID();
const outsiderId = randomUUID();
const adminId = randomUUID();
const accountId = randomUUID();
const replacementAccountId = randomUUID();
type BindingRow = {
  configuration: Record<string, unknown>;
  account_reference_id: string | null;
  checkpoint_version: number;
  credential_generation: number;
};

function editableSources(
  sources: Array<{
    sourceKey: string;
    enabled: boolean;
    required: boolean;
    accountReferenceId?: string | null;
    configuration: { url?: string; feedUrl?: string; notes?: string };
  }>,
): DiscoverySourceDraft[] {
  return sources.map((source) => ({
    sourceKey: source.sourceKey,
    enabled: source.enabled,
    required: source.required,
    accountReferenceId: source.accountReferenceId ?? null,
    configuration: source.configuration,
  }));
}

it("proves Discovery publication fencing, access, CAS, immutable history, and server-only storage", async () => {
  await db.execute(sql`
    insert into public.employee (employee_id, display_name, email)
    values
      (${ownerId}::uuid, 'Discovery proof owner', ${`discovery-owner-${ownerId}@example.invalid`}),
      (${reviewerId}::uuid, 'Discovery proof reviewer', ${`discovery-reviewer-${reviewerId}@example.invalid`}),
      (${outsiderId}::uuid, 'Discovery proof outsider', ${`discovery-outsider-${outsiderId}@example.invalid`}),
      (${adminId}::uuid, 'Discovery proof admin', ${`discovery-admin-${adminId}@example.invalid`})
  `);
  await db.execute(sql`
    insert into public.connection_account (
      connection_account_id, owner_employee_id, toolkit, scope, status
    ) values
      (${accountId}::uuid, ${ownerId}::uuid, 'apollo', 'staff', 'connected'),
      (${replacementAccountId}::uuid, ${ownerId}::uuid, 'apollo', 'staff', 'connected')
  `);

  const sources = defaultDiscoverySources().map((source) =>
    source.sourceKey === "apollo_organisation_search"
      ? { ...source, accountReferenceId: accountId }
      : source,
  );
  const created = await createDiscoveryProgramme({
    config: {
      ...DEFAULT_DISCOVERY_PROGRAMME_CONFIG,
      name: `Postgres proof ${randomUUID()}`,
      ownerEmployeeId: ownerId,
      reviewerEmployeeIds: [],
    },
    sources,
    actorEmployeeId: ownerId,
  });
  expect(created).toMatchObject({
    version: 1,
    draftVersion: 1,
    publishedVersion: null,
  });

  const firstPublication = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: created.version,
    actorEmployeeId: adminId,
  });
  expect(firstPublication).toMatchObject({
    state: "active",
    version: 2,
    publishedVersion: 1,
    reviewerEmployeeIds: [],
  });

  const reviewerDraft = await saveDiscoveryProgrammeDraft({
    programmeId: created.id,
    expectedVersion: firstPublication.version,
    config: {
      ...firstPublication.draft.config,
      reviewerEmployeeIds: [reviewerId],
    },
    sources: editableSources(firstPublication.draft.sources),
    actorEmployeeId: adminId,
    isAdmin: true,
  });
  expect(reviewerDraft.reviewerEmployeeIds).toEqual([]);
  await expect(
    getDiscoveryProgramme({
      programmeId: created.id,
      actorEmployeeId: reviewerId,
      isAdmin: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  const reviewerPublication = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: reviewerDraft.version,
    actorEmployeeId: adminId,
  });
  expect(reviewerPublication.reviewerEmployeeIds).toEqual([reviewerId]);
  await expect(
    getDiscoveryProgramme({
      programmeId: created.id,
      actorEmployeeId: reviewerId,
      isAdmin: false,
    }),
  ).resolves.toMatchObject({ id: created.id, publishedVersion: 2 });
  await expect(
    getDiscoveryProgramme({
      programmeId: created.id,
      actorEmployeeId: outsiderId,
      isAdmin: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  const [bindingBeforeDraft] = await db.execute<BindingRow>(sql`
    select configuration, account_reference_id, checkpoint_version,
      credential_generation
    from public.research_programme_source_binding
    where research_programme_id = ${created.id}::uuid
      and source_key = 'campaign_me'
  `);
  const draftSources = editableSources(reviewerPublication.draft.sources)
    .filter((source) => source.sourceKey !== "time_out_dubai")
    .map((source) =>
      source.sourceKey === "campaign_me"
        ? {
            ...source,
            configuration: {
              ...source.configuration,
              url: "https://www.hrmny.co/research/",
            },
          }
        : source,
    );
  const baseConfig = reviewerPublication.draft.config;
  const competingWrites = await Promise.allSettled([
    saveDiscoveryProgrammeDraft({
      programmeId: created.id,
      expectedVersion: reviewerPublication.version,
      config: { ...baseConfig, purpose: `${baseConfig.purpose} CAS A.` },
      sources: draftSources,
      actorEmployeeId: ownerId,
      isAdmin: false,
    }),
    saveDiscoveryProgrammeDraft({
      programmeId: created.id,
      expectedVersion: reviewerPublication.version,
      config: { ...baseConfig, purpose: `${baseConfig.purpose} CAS B.` },
      sources: draftSources,
      actorEmployeeId: ownerId,
      isAdmin: false,
    }),
  ]);
  expect(
    competingWrites.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    competingWrites.filter((result) => result.status === "rejected"),
  ).toHaveLength(1);
  expect(
    competingWrites.find((result) => result.status === "rejected"),
  ).toMatchObject({
    reason: { code: "CONFLICT", message: "PROGRAMME_VERSION_CONFLICT" },
  });

  const current = await getDiscoveryProgramme({
    programmeId: created.id,
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(current.publishedVersion).toBe(2);
  expect(current.draftVersion).toBe(3);
  expect(
    current.draft.sources.find(
      (source) => source.sourceKey === "time_out_dubai",
    ),
  ).toMatchObject({ enabled: false, required: true });
  expect(current.readiness.blockers).toContainEqual(
    expect.objectContaining({
      code: "SOURCE_UNVERIFIED",
      sourceKey: "time_out_dubai",
    }),
  );

  const [bindingAfterDraft] = await db.execute<BindingRow>(sql`
    select configuration, account_reference_id, checkpoint_version,
      credential_generation
    from public.research_programme_source_binding
    where research_programme_id = ${created.id}::uuid
      and source_key = 'campaign_me'
  `);
  expect(bindingAfterDraft).toEqual(bindingBeforeDraft);

  const changedPublication = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: current.version,
    actorEmployeeId: adminId,
  });
  const [bindingBeforeDisconnect] = await db.execute<{
    credential_generation: number;
    checkpoint_version: number;
  }>(sql`
    select credential_generation, checkpoint_version
    from public.research_programme_source_binding
    where research_programme_id = ${created.id}::uuid
      and source_key = 'apollo_organisation_search'
  `);
  await expect(
    disconnectGovernedApiKeyConnection({
      database: db,
      employeeId: ownerId,
      connectionAccountId: accountId,
      expectedToolkit: "apollo",
    }),
  ).resolves.toMatchObject({ connectionAccountId: accountId });
  const [disconnectedBinding] = await db.execute<{
    account_reference_id: string | null;
    capability_state: string;
    connection_state: string;
    credential_generation: number;
    checkpoint_version: number;
    capability_test_receipt_id: string | null;
    cursor: unknown;
    last_error: string | null;
    coverage: Record<string, unknown>;
    connection_count: number;
  }>(sql`
    select account_reference_id, capability_state, connection_state,
      credential_generation, checkpoint_version, capability_test_receipt_id,
      cursor, last_error, coverage,
      (select count(*)::int from public.connection_account
        where connection_account_id = ${accountId}::uuid) as connection_count
    from public.research_programme_source_binding
    where research_programme_id = ${created.id}::uuid
      and source_key = 'apollo_organisation_search'
  `);
  expect(disconnectedBinding).toEqual({
    account_reference_id: null,
    capability_state: "unverified",
    connection_state: "needs_connection",
    credential_generation:
      (bindingBeforeDisconnect?.credential_generation ?? -1) + 1,
    checkpoint_version: (bindingBeforeDisconnect?.checkpoint_version ?? -1) + 1,
    capability_test_receipt_id: null,
    cursor: null,
    last_error: "Connection disconnected",
    coverage: {},
    connection_count: 0,
  });
  const historicalAfterDisconnect = await getDiscoveryProgramme({
    programmeId: created.id,
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(
    historicalAfterDisconnect.published?.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    )?.accountReferenceId,
  ).toBe(accountId);
  await expect(
    publishDiscoveryProgramme({
      programmeId: created.id,
      expectedVersion: changedPublication.version,
      actorEmployeeId: adminId,
    }),
  ).rejects.toMatchObject({ code: "INVALID_CONNECTION" });

  const replacementSources = editableSources(
    changedPublication.draft.sources,
  ).map((source) =>
    source.sourceKey === "apollo_organisation_search"
      ? { ...source, accountReferenceId: replacementAccountId }
      : source,
  );
  const replacementDraft = await saveDiscoveryProgrammeDraft({
    programmeId: created.id,
    expectedVersion: changedPublication.version,
    config: changedPublication.draft.config,
    sources: replacementSources,
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(
    replacementDraft.draft.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    )?.accountReferenceId,
  ).toBe(replacementAccountId);
  expect(
    replacementDraft.published?.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    )?.accountReferenceId,
  ).toBe(accountId);

  const rejectPublish = async () =>
    expect(
      publishDiscoveryProgramme({
        programmeId: created.id,
        expectedVersion: replacementDraft.version,
        actorEmployeeId: adminId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONNECTION" });
  await db.execute(sql`
    update public.connection_account set status = 'disconnected'
    where connection_account_id = ${replacementAccountId}::uuid
  `);
  await rejectPublish();
  await db.execute(sql`
    update public.connection_account set status = 'connected', toolkit = 'gmail'
    where connection_account_id = ${replacementAccountId}::uuid
  `);
  await rejectPublish();
  await db.execute(sql`
    update public.connection_account set toolkit = 'apollo', owner_employee_id = ${outsiderId}::uuid
    where connection_account_id = ${replacementAccountId}::uuid
  `);
  await rejectPublish();
  await db.execute(sql`
    update public.connection_account set owner_employee_id = ${ownerId}::uuid
    where connection_account_id = ${replacementAccountId}::uuid
  `);
  await db.execute(sql`
    update public.employee set is_active = false
    where employee_id = ${ownerId}::uuid
  `);
  await expect(
    publishDiscoveryProgramme({
      programmeId: created.id,
      expectedVersion: replacementDraft.version,
      actorEmployeeId: adminId,
    }),
  ).rejects.toMatchObject({ code: "INVALID_PRINCIPAL" });
  await db.execute(sql`
    update public.employee set is_active = true
    where employee_id = ${ownerId}::uuid
  `);

  const replacementPublication = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: replacementDraft.version,
    actorEmployeeId: adminId,
  });
  expect(
    replacementPublication.published?.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    )?.accountReferenceId,
  ).toBe(replacementAccountId);

  const disconnectedDraft = await saveDiscoveryProgrammeDraft({
    programmeId: created.id,
    expectedVersion: replacementPublication.version,
    config: replacementPublication.draft.config,
    sources: editableSources(replacementPublication.draft.sources).map(
      (source) =>
        source.sourceKey === "apollo_organisation_search"
          ? { ...source, accountReferenceId: null }
          : source,
    ),
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(
    disconnectedDraft.draft.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    )?.accountReferenceId,
  ).toBeNull();
  expect(
    disconnectedDraft.published?.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    )?.accountReferenceId,
  ).toBe(replacementAccountId);
  const disconnectedPublication = await publishDiscoveryProgramme({
    programmeId: created.id,
    expectedVersion: disconnectedDraft.version,
    actorEmployeeId: adminId,
  });
  expect(
    disconnectedPublication.published?.sources.find(
      (source) => source.sourceKey === "apollo_organisation_search",
    )?.accountReferenceId,
  ).toBeNull();

  const [counts] = await db.execute<{
    version_count: number;
    draft_audit_count: number;
  }>(sql`
    select
      (select count(*)::int from public.research_programme_version
        where research_programme_id = ${created.id}::uuid) as version_count,
      (select count(*)::int from public.audit_event
        where entity_type = 'research_programme'
          and entity_id = ${created.id}::uuid
          and action = 'sales.discovery.programme.draft_saved') as draft_audit_count
  `);
  expect(counts).toEqual({ version_count: 5, draft_audit_count: 4 });

  await expect(
    db.execute(sql`
      update public.research_programme_version
      set configuration = '{}'::jsonb
      where research_programme_id = ${created.id}::uuid
        and version_number = 2
    `),
  ).rejects.toThrow("Discovery programme versions are immutable");

  const [security] = await db.execute<{
    all_rls: boolean;
    authenticated_denied: boolean;
    service_role_limited: boolean;
  }>(sql`
    select
      (select count(*) = 3 from pg_class
        where oid in (
          'public.research_programme'::regclass,
          'public.research_programme_version'::regclass,
          'public.research_programme_source_binding'::regclass
        ) and relrowsecurity) as all_rls,
      case when exists (select 1 from pg_roles where rolname = 'authenticated')
        then not (
          has_table_privilege('authenticated', 'public.research_programme', 'SELECT,INSERT,UPDATE,DELETE')
          or has_table_privilege('authenticated', 'public.research_programme_version', 'SELECT,INSERT,UPDATE,DELETE')
          or has_table_privilege('authenticated', 'public.research_programme_source_binding', 'SELECT,INSERT,UPDATE,DELETE')
        ) else true end as authenticated_denied,
      case when exists (select 1 from pg_roles where rolname = 'service_role')
        then has_table_privilege('service_role', 'public.research_programme', 'SELECT,INSERT,UPDATE')
          and has_table_privilege('service_role', 'public.research_programme_version', 'SELECT,INSERT')
          and not has_table_privilege('service_role', 'public.research_programme_version', 'UPDATE')
          and has_table_privilege('service_role', 'public.research_programme_source_binding', 'SELECT,INSERT,UPDATE')
          and not has_table_privilege('service_role', 'public.research_programme', 'DELETE,TRUNCATE')
          and not has_table_privilege('service_role', 'public.research_programme_version', 'DELETE,TRUNCATE')
          and not has_table_privilege('service_role', 'public.research_programme_source_binding', 'DELETE,TRUNCATE')
        else true end as service_role_limited
  `);
  expect(security).toEqual({
    all_rls: true,
    authenticated_denied: true,
    service_role_limited: true,
  });
});
