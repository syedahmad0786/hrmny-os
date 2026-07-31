# M1 Substrate Completion Audit

Audit date: 2026-07-31

Release register: `M1 Acceptance` and `Implementation Queue` in the production-readiness workbook

Candidate: PR #39, `ahmadbukhari097/codex/m1-production-readiness`

## Executive conclusion

M1 is **not yet complete**. The release candidate is software-green in CI and
preview, and the migration chain now has a real disposable Supabase-Postgres
fresh/upgrade verifier. The candidate must not be promoted until migration
`0070_m1_production_readiness.sql` is applied and verified on the target
Supabase project.

The two remaining internal acceptance rows are the production M1 proof thread
(`M1-GATE-001`) and reproducible production release/rollback (`M1-SYS-06`).
Both depend on target database authority; neither may be relabelled green from
preview or static evidence alone.

M2+ features, Creative Hub, Canva, client-portal expansion, and AI creative
production do not block this M1 substrate milestone. The old signed Module 1
Lead-to-Cash outcome remains a later multi-milestone commercial deliverable.

## Authoritative current state

| Surface | Current evidence | Status |
| --- | --- | --- |
| Candidate branch | PR #39; exact promoted commit must match the final green CI run | Software work in progress |
| Existing candidate preview | `dpl_B9rLnbKVH1hPJ1Fp61r9PxaSnW1M`, commit `6b851e061a92eb0559717f93f6dc9e793a35e093`, Ready | Superseded when this audit change receives a new preview |
| Production | `https://hrmny-os-web.vercel.app`, `dpl_Fv17vS8cQULcwNew2Euiz7pCJTzG`, commit `3b3c65dcc0bf20254332dfe6ce45ef8d16af87b5`, `sin1` | Known-good rollback deployment; candidate not promoted |
| Production errors | Vercel grouped runtime errors, last 24 hours | No clusters reported at audit time |
| Target Supabase | `klrugedztqxlvyghyzxs`, Singapore | Operator permission denied; `0070` target proof unavailable |
| Automated quality | Node 24, pnpm 9.15.9, frozen install, zero-warning lint, typecheck, tests, build, Playwright and Axe | Green on the last candidate; rerun required for final commit |
| Migration quality | Pinned `supabase/postgres:17.6.1.141`; all 70 journal entries from empty; 0069→0070; second 0070 apply; RLS/Data API/trigger/schema assertions | Green locally; independent CI database job required |

## Software-controlled M1 scope

The candidate implements and tests:

- hosted fail-closed authentication and database behavior;
- production role and permission management with audit and last-Partner protection;
- real gate-transition proof while `/gate` stays hidden in production;
- append-only audit and filtered admin audit UI;
- Work Files DAM with Work-item authorization, immutable versions, private
  storage, five-minute signed access, QC, validation, race protection, and
  orphan cleanup;
- persisted `gate_blocked`, `auth_denied`, `dam_upload`, `spend_cap`, and
  `job_lag` health signals with durable Chat delivery attempts;
- protected, idempotent cron processing with bounded retries and visible lag;
- real admin features, connection status, conventions, roles, health, and Work
  UI states;
- explicit route exposure rules that keep `/gate` and `/assets` unavailable in
  production while DAM is accepted through Work Files;
- additive migration `0070`, plus a clean-database and upgrade verifier that
  proves RLS, Data API denial, append-only triggers, Work-DAM linkage, role
  uniqueness, and durable health delivery state.

## Required release sequence

1. Grant the release operator access to Supabase project
   `klrugedztqxlvyghyzxs`, or have the authorized owner apply `0070` from this
   exact candidate.
2. Confirm the target migration journal reaches `0070`; run security/performance
   advisors and the target RLS/Data API/constraint/index/trigger checks.
3. Validate production environment-variable presence without reading secret
   values. Hosted runtime must require Supabase auth, database, private storage,
   server credentials, and `CRON_SECRET`.
4. Promote the exact green candidate to `hrmny-os-web.vercel.app` while
   retaining `dpl_Fv17vS8cQULcwNew2Euiz7pCJTzG` as the rollback target.
5. Run the dedicated `[M1-PROOF]` production thread: sign in, inspect
   permissions, create a Work asset, upload versions 1 and 2, QC, open a signed
   download, then inspect audit and health.
6. Verify deployment ID, commit, `sin1`, HTTP and authenticated redirects,
   persistence across redeploy, and no unresolved Critical/High runtime cluster
   during the smoke window.
7. Record exact evidence in the existing `M1 Acceptance` and
   `Implementation Queue` sheets. M1 software readiness becomes green only when
   zero internal rows remain Partial/Failed and rollback evidence is present.

## External holds

These holds are excluded from the software-readiness score only after the
related software path is green:

| Hold | Owner | Missing input | Affected proof |
| --- | --- | --- | --- |
| Target Supabase project authority | HRMNY technical owner | Grant project access or apply `0070` and return dated results | Target migration, persistence and production promotion |
| Workspace persona accounts | HRMNY IT / Ayham / Molham | Approved AM, Finance, Partner and Director test accounts | Live SSO, margin redaction and separation-of-duties browser proof |
| Google Chat webhook | HRMNY technical owner | Rotated webhook and visible test message | Live Chat delivery only |
| Secret-manager rotation | HRMNY technical owner | Keeper/approved-store entry and rotation record | Team-controlled credential proof |
| Commercial acceptance/payment | Ayham and Molham | Written acceptance/payment approval | External milestone acceptance only |

No external hold may conceal unfinished code, CI, migration logic, UI behavior,
or internally obtainable evidence.

## Completion rule

Do not call M1 complete until the production commit equals the recorded evidence,
`M1-GATE-001` and `M1-SYS-06` are no longer Partial, all other internal rows
remain green, rollback proof is recorded, and every unavailable third-party or
owner proof is separately labelled `EXTERNAL HOLD`.
