# M1 Substrate Completion Audit

Audit date: 2026-07-31

Release register: `M1 Acceptance` and `Implementation Queue` in the production-readiness workbook

Candidate: PR #39, `ahmadbukhari097/codex/m1-production-readiness`

## Executive conclusion

M1 is **not yet complete**. Migration
`0070_m1_production_readiness.sql` has been applied to the target Supabase
project and its schema, constraint, index, RLS, Data API, append-only, storage,
and second-apply postchecks passed. Target database access is therefore no
longer an M1 blocker.

The exact candidate `9019c48aec431f674cd8208920ef8cad3dec2dfc` is green in
both CI runs and has two successful previews. Exact-head HTTP proof confirms a
protected staff route redirects to login, development probes remain hidden, and
unauthorized cron access is denied. A persisted Work Files asset with two
immutable versions and QC pass loaded successfully through the authenticated UI
on predecessor `0557639664b01674ea7960659b606b87a292a16a` after redeployment.
The remaining internal browser gap is to repeat the authenticated thread on
exact `9019c48a…`. Production M1 proof (`M1-GATE-001`) and promotion/rollback
evidence (`M1-SYS-06`) remain open because the authoritative production project
has not been promoted. No predecessor-preview proof may be relabelled as
final-head or production proof.

M2+ features, Creative Hub, Canva, client-portal expansion, and AI creative
production do not block this M1 substrate milestone. The old signed Module 1
Lead-to-Cash outcome remains a later multi-milestone commercial deliverable.

## Authoritative current state

| Surface | Current evidence | Status |
| --- | --- | --- |
| Candidate branch | PR #39, exact `9019c48aec431f674cd8208920ef8cad3dec2dfc` | Draft; both CI runs green; not promoted |
| CI | Runs `30630322017` and `30630325063`: verify, database and E2E jobs all passed on exact `9019c48a…` | Green |
| HRMNY-team preview | `https://hrmny-j4o3vx9as-hrmnyco.vercel.app`, `dpl_DogRZzfMSWNuqccRX46uW1K4UGpV`, exact `9019c48a…`, READY; functions inspected in `sin1` | Deployment green; exact-head anonymous/probe assertions passed; authenticated thread not yet recorded |
| Authoritative preview | `https://hrmny-os-e694z751p-ahmad-bukharis-projects-74a52414.vercel.app`, `dpl_A1yvv9AoPNudccTZYLPoVskfFRGX`, exact `9019c48a…`, GitHub deployment success; repository config targets `sin1` | Deployment green; supplied Vercel credential cannot inspect this project's runtime logs |
| Exact-head HTTP proof | `9019c48a…` on `hrmny-os`: `/roles` returned 307 to `/login?next=%2Froles`; `/gate` and `/assets` returned 404; unauthenticated `/api/cron/jobs` returned 401 | Green security assertions |
| Authenticated Work Files proof | Exact predecessor `0557639664b01674ea7960659b606b87a292a16a`: persisted `[M1-PROOF]` Work asset reloaded in authenticated UI with QC pass and versions 1 and 2; the original create/upload/QC/signed-download/audit thread passed on `a274725…` | Valid redeploy regression evidence; repeat the authenticated thread on exact `9019c48a…` before promotion |
| Production | `https://hrmny-os-web.vercel.app`, `dpl_Fv17vS8cQULcwNew2Euiz7pCJTzG`, commit `3b3c65dcc0bf20254332dfe6ce45ef8d16af87b5`, `sin1` | Known-good rollback deployment; candidate not promoted |
| Candidate runtime errors | Exact `9019c48a…` `hrmny-os` smoke window: four expected requests (307, 401, 404, 404), zero 5xx, zero error/fatal entries, and no timeout/database-reset signature | Green for observed preview window; repeat on authoritative production after promotion |
| Target Supabase | `klrugedztqxlvyghyzxs`, Singapore; journal at 0070; private `hrmny-dam` bucket present | Migration and postchecks passed |
| Automated quality | Exact `9019c48a…`: both CI runs completed successfully with zero-warning lint, typecheck, tests, build, database proof and 11 Playwright tests; the web suite reports 76 files and 362 tests passed | Green; retain both run URLs in the release register |
| Migration quality | Pinned `supabase/postgres:17.6.1.141`; all 70 journal entries from empty; 0069→0070; target apply; second target apply; RLS/Data API/trigger/schema assertions | Green; retain dated target output in the release register |

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

1. Repeat sign-in, employee mapping, permission resolution, logout, expiry,
   protected redirects and the authenticated Work Files/audit thread on exact
   `9019c48a…`; verify its records survive a redeploy. Retain the successful
   `0557639…` persistence load and `a274725…` full browser flow as predecessor
   regression evidence only.
2. Retain the two green exact-head CI runs, READY `sin1` deployment evidence and
   their URLs in the release register. Rerun the full gate if the candidate SHA
   changes.
3. Confirm the already-applied target journal remains at `0070` and attach the
   dated target RLS/Data API/constraint/index/trigger postcheck output. Do not
   manufacture a second migration blocker.
4. Validate production environment-variable presence without reading secret
   values. Hosted runtime must require Supabase auth, database, private storage,
   server credentials, and `CRON_SECRET`.
5. Promote the exact green candidate to `hrmny-os-web.vercel.app` while
   retaining `dpl_Fv17vS8cQULcwNew2Euiz7pCJTzG` as the rollback target.
6. Run the dedicated `[M1-PROOF]` production thread: sign in, inspect
   permissions, create a Work asset, upload versions 1 and 2, QC, open a signed
   download, then inspect audit and health.
7. Verify deployment ID, commit, `sin1`, HTTP and authenticated redirects,
   persistence across redeploy, and no unresolved Critical/High runtime cluster
   during the smoke window.
8. Execute and record the exact rollback rehearsal in `CUTOVER.md`; migration
   0070 remains applied because it is additive and backward-compatible.
9. Record exact evidence in the existing `M1 Acceptance` and
   `Implementation Queue` sheets. M1 software readiness becomes green only when
   zero internal rows remain Partial/Failed and rollback evidence is present.

## External holds

These holds are excluded from the software-readiness score only after the
related software path is green:

| Hold | Owner | Missing input | Affected proof |
| --- | --- | --- | --- |
| Authoritative production-promotion authority | HRMNY Vercel owner | Promote exact `9019c48a…` to `hrmny-os-web` or grant scoped production authority | Production proof and rollback rehearsal |
| Authoritative Vercel runtime access | `hrmny-os-web` project owner | Grant the release operator scoped inspect/log access; supplied credential only accesses `hrmnyco` | Authoritative-preview and post-promotion runtime-log proof |
| Google OAuth redirect allowlist | HRMNY Google/Supabase owner | Allow the authoritative preview callback/return URL | Real preview Google sign-in proof |
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
