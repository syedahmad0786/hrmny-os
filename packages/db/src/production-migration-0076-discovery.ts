import type { Sql } from "postgres";
import { readApollo0075SchemaState } from "./production-migration-0075-discovery";
import type {
  Apollo0076SchemaState,
  Production0076Phase,
} from "./production-migration-0076-contract";

/** Shared exact schema readback used by disposable proof and production guard. */
export async function readApollo0076SchemaState(
  db: Sql,
  phase: Production0076Phase,
): Promise<Apollo0076SchemaState> {
  const prior = await readApollo0075SchemaState(db, "verify");
  const priorContractReady =
    prior.priorContractReady &&
    prior.namedColumnsPresent === 9 &&
    prior.correctColumns === 9 &&
    prior.namedConstraintsPresent === 3 &&
    prior.correctConstraints === 3 &&
    prior.namedIndexesPresent === 2 &&
    prior.correctIndexes === 2 &&
    prior.securedTables === 2 &&
    prior.backfillViolations === 0;

  const [schema] = await db<
    Array<
      Omit<
        Apollo0076SchemaState,
        "priorContractReady" | "backfillViolations" | "duplicateRunningSlots"
      >
    >
  >`
    select
      (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'scheduled_job'
          and column_name = 'concurrency_key'
      ) as "namedColumnsPresent",
      (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'scheduled_job'
          and column_name = 'concurrency_key'
          and udt_name = 'text'
          and is_nullable = 'YES'
          and column_default is null
      ) as "correctColumns",
      (
        select count(*)::int
        from pg_constraint constraint_info
        where constraint_info.conrelid = 'public.scheduled_job'::regclass
          and constraint_info.conname =
            'scheduled_job_apollo_concurrency_key_chk'
      ) as "namedChecksPresent",
      (
        select count(*)::int
        from pg_constraint constraint_info
        where constraint_info.conrelid = 'public.scheduled_job'::regclass
          and constraint_info.conname =
            'scheduled_job_apollo_concurrency_key_chk'
          and constraint_info.contype = 'c'
          and constraint_info.convalidated
          and regexp_replace(
            lower(pg_get_expr(
              constraint_info.conbin,
              constraint_info.conrelid,
              true
            )),
            '[()[:space:]]', '', 'g'
          ) =
            'kind=''apollo_people_search''::textandconcurrency_keyisnotnullandconcurrency_key=''provider:apollo''::textorkind<>''apollo_people_search''::textandconcurrency_keyisdistinctfrom''provider:apollo''::text'
      ) as "correctChecks",
      (
        select count(*)::int
        from pg_index index_info
        join pg_class index_relation
          on index_relation.oid = index_info.indexrelid
        where index_info.indrelid = 'public.scheduled_job'::regclass
          and index_relation.relname =
            'scheduled_job_running_concurrency_uniq'
      ) as "namedIndexesPresent",
      (
        select count(*)::int
        from pg_index index_info
        join pg_class index_relation
          on index_relation.oid = index_info.indexrelid
        join pg_attribute key_attribute
          on key_attribute.attrelid = index_info.indrelid
          and key_attribute.attnum = index_info.indkey[0]
          and not key_attribute.attisdropped
        where index_info.indrelid = 'public.scheduled_job'::regclass
          and index_relation.relname =
            'scheduled_job_running_concurrency_uniq'
          and index_info.indisunique
          and index_info.indisvalid
          and index_info.indisready
          and index_info.indnatts = 1
          and index_info.indnkeyatts = 1
          and key_attribute.attname = 'concurrency_key'
          and regexp_replace(
            lower(pg_get_expr(
              index_info.indpred,
              index_info.indrelid,
              true
            )),
            '[()[:space:]]', '', 'g'
          ) =
            'status=''running''::textandconcurrency_keyisnotnull'
      ) as "correctIndexes",
      (
        select count(*)::int
        from pg_proc function_info
        join pg_namespace function_schema
          on function_schema.oid = function_info.pronamespace
        where function_schema.nspname = 'public'
          and function_info.proname =
            'scheduled_job_assign_apollo_concurrency_key'
          and function_info.pronargs = 0
      ) as "namedFunctionsPresent",
      (
        select count(*)::int
        from pg_proc function_info
        join pg_namespace function_schema
          on function_schema.oid = function_info.pronamespace
        join pg_language function_language
          on function_language.oid = function_info.prolang
        where function_schema.nspname = 'public'
          and function_info.proname =
            'scheduled_job_assign_apollo_concurrency_key'
          and function_info.pronargs = 0
          and function_info.prorettype = 'trigger'::regtype
          and function_info.prokind = 'f'
          and function_language.lanname = 'plpgsql'
          and not function_info.prosecdef
          and array_position(
            function_info.proconfig,
            'search_path=pg_catalog, public'
          ) is not null
          and regexp_replace(
            lower(function_info.prosrc), '[[:space:]]', '', 'g'
          ) =
            'beginifnew.kind=''apollo_people_search''thennew.concurrency_key:=''provider:apollo'';elsifnew.concurrency_key=''provider:apollo''thennew.concurrency_key:=null;endif;returnnew;end;'
          and not exists (
            select 1
            from aclexplode(coalesce(
              function_info.proacl,
              acldefault('f', function_info.proowner)
            )) acl
            where acl.grantee = 0
              and acl.privilege_type = 'EXECUTE'
          )
      ) as "correctFunctions",
      (
        select count(*)::int
        from pg_trigger trigger_info
        where trigger_info.tgrelid = 'public.scheduled_job'::regclass
          and trigger_info.tgname =
            'scheduled_job_assign_apollo_concurrency_key_trg'
          and not trigger_info.tgisinternal
      ) as "namedTriggersPresent",
      (
        select count(*)::int
        from pg_trigger trigger_info
        join pg_proc function_info
          on function_info.oid = trigger_info.tgfoid
        join pg_namespace function_schema
          on function_schema.oid = function_info.pronamespace
        where trigger_info.tgrelid = 'public.scheduled_job'::regclass
          and trigger_info.tgname =
            'scheduled_job_assign_apollo_concurrency_key_trg'
          and not trigger_info.tgisinternal
          and trigger_info.tgenabled = 'O'
          and trigger_info.tgtype = 23
          and function_schema.nspname = 'public'
          and function_info.proname =
            'scheduled_job_assign_apollo_concurrency_key'
          and lower(pg_get_triggerdef(trigger_info.oid, true)) like
            '%before insert or update of kind, concurrency_key%'
          and lower(pg_get_triggerdef(trigger_info.oid, true)) like
            '%for each row execute function%'
      ) as "correctTriggers",
      (
        select count(*)::int
        from pg_class relation
        where relation.oid = 'public.scheduled_job'::regclass
          and relation.relrowsecurity
          and not exists (
            select 1
            from aclexplode(
              coalesce(relation.relacl, acldefault('r', relation.relowner))
            ) acl
            where acl.grantee = 0
              and acl.privilege_type in (
                'SELECT', 'INSERT', 'UPDATE', 'DELETE'
              )
          )
          and not (
            (exists(select 1 from pg_roles where rolname = 'anon')
              and has_table_privilege(
                'anon', 'public.scheduled_job',
                'SELECT,INSERT,UPDATE,DELETE'
              ))
            or
            (exists(select 1 from pg_roles where rolname = 'authenticated')
              and has_table_privilege(
                'authenticated', 'public.scheduled_job',
                'SELECT,INSERT,UPDATE,DELETE'
              ))
          )
      ) as "securedTables",
      (
        select count(*)::int
        from public.scheduled_job
        where kind = 'apollo_people_search'
          and status = 'running'
      ) as "runningApolloJobs"
  `;
  if (!schema) throw new Error("0076 schema discovery returned no row.");

  return {
    priorContractReady,
    ...schema,
    backfillViolations: await readApollo0076BackfillViolations(db, phase),
    duplicateRunningSlots: await readApollo0076DuplicateRunningSlots(db, phase),
  };
}

export async function readApollo0076BackfillViolations(
  db: Sql,
  phase: Production0076Phase,
): Promise<number> {
  if (phase === "preflight") return 0;
  const [row] = await db<Array<{ count: number }>>`
    select count(*)::int as count
    from public.scheduled_job
    where (
      kind = 'apollo_people_search'
      and concurrency_key is distinct from 'provider:apollo'
    ) or (
      kind <> 'apollo_people_search'
      and concurrency_key = 'provider:apollo'
    )
  `;
  return row?.count ?? -1;
}

export async function readApollo0076DuplicateRunningSlots(
  db: Sql,
  phase: Production0076Phase,
): Promise<number> {
  if (phase === "preflight") {
    const [row] = await db<Array<{ count: number }>>`
      select greatest(count(*)::int - 1, 0) as count
      from public.scheduled_job
      where kind = 'apollo_people_search'
        and status = 'running'
    `;
    return row?.count ?? -1;
  }
  const [row] = await db<Array<{ count: number }>>`
    select coalesce(sum(slot.count - 1), 0)::int as count
    from (
      select count(*)::int as count
      from public.scheduled_job
      where status = 'running'
        and concurrency_key is not null
      group by concurrency_key
      having count(*) > 1
    ) slot
  `;
  return row?.count ?? -1;
}
