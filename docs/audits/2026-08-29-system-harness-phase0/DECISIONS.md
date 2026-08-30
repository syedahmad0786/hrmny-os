# Decisions

Common scope/date/actor for every record unless superseded: 2026-08-29; `client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; `Codex /root`; branch `ahmadbukhari097/codex/phase-0-baseline-20260829`; baseline `c9b420d9ad3852ea5aef042b3ad21c0399f2f72a`; implementation commit `1d0920cb49a8142c3141288a80fb7d028fe6a96c`.

## `ADR-HRMNY-20260829-001` — authority order

- Decision/finding: use current `origin/main`, then `PLAN-PRODUCTION`, Sales cutover, verified receipts, shared business specs, and finally historical plans.
- Reason: it preserves as-built truth while retaining valid business/security requirements.
- Alternatives: use old shared architecture; redesign from the mission alone.
- Trade-offs: conflicts require explicit ADR work rather than fast copying.
- Evidence: `SOURCE-REGISTER.md`; source reconciliation audit.
- Confidence/freshness: high; current 2026-08-29.
- Affected components: all.
- Status: accepted for this program.
- Supersedes/superseded by: supersedes undocumented source mixing; none.
- Rollback/correction: superseding ADR with owner-approved authority evidence.

## `ADR-HRMNY-20260829-002` — clean repository boundary

- Decision/finding: implement only in the isolated worktree/feature branch based on exact current `origin/main`.
- Reason: the coordination workspace is dirty and contains unrelated/nested repositories.
- Alternatives: edit the coordination directory; work on `main`.
- Trade-offs: specifications remain read-only external inputs.
- Evidence: `EVID-001`, `EVID-002`.
- Confidence/freshness: high; current.
- Affected components: source control, evidence, release.
- Status: active.
- Supersedes/superseded by: supersedes prior dirty-checkout risk; none.
- Rollback/correction: close worktree/branch only after preserving review evidence; no destructive cleanup without approval.

## `ADR-HRMNY-20260829-003` — preserve operational authority

- Decision/finding: Supabase/PostgreSQL remains authoritative for CRM, Work, approvals, effects, receipts, portal state, and runtime mappings.
- Reason: QM and GBrain are execution/retrieval services, not transactional authorities.
- Alternatives: make QM filesystem or GBrain graph authoritative.
- Trade-offs: bridges and readback receipts add implementation cost.
- Evidence: current schema/code, governing plan, QM/GBrain audits.
- Confidence/freshness: high.
- Affected components: QM, GBrain, Sales, portal, integrations.
- Status: accepted.
- Supersedes/superseded by: supersedes generic topology implications; none.
- Rollback/correction: separate migration ADR with recovery and UAT proof.

## `ADR-HRMNY-20260829-004` — QM boundary and pilot mapping

- Decision/finding: pin QM `v0.1.5`/commit `d931fe9...`; use stable scope-derived Fly Sprites, initially one personal Sprite for each of two named employees; no public/client principals.
- Reason: upstream reuses persistent Sprites and is experimental, so Machine-per-chat is unsupported and public multi-tenancy is unsafe.
- Alternatives: Machine per message/session; embed QM in HRMNY web; direct client access.
- Trade-offs: fixed pilot cost and a scoped gateway/effect broker are required.
- Evidence: QM/Fly audit and upstream release/security/deployment sources.
- Confidence/freshness: medium-high; upstream current, live HRMNY deployment absent.
- Affected components: QM, Fly, gateway, sessions, observability.
- Status: contract-ready; deployment blocked on human checkpoints.
- Supersedes/superseded by: supersedes treating current `/chat` as QM runtime; may be superseded after pinned pilot proof.
- Rollback/correction: disable gateway/session bindings and remove only named pilot resources after approval.

## `ADR-HRMNY-20260829-005` — Google Chat channel split

- Decision/finding: implement a provider-neutral channel interface with separate interactive Google Chat app and one-way webhook alert adapters.
- Reason: webhooks cannot authenticate interactions; Slack renaming would not implement Google identity/thread semantics.
- Alternatives: incoming webhook as QM; rename Slack classes; direct synchronous work.
- Trade-offs: durable inbox/outbox, mappings, retries, and membership reconciliation are required.
- Evidence: Google Chat audit and official Google docs in `SOURCE-REGISTER.md`.
- Confidence/freshness: high for provider contract; account ownership unverified.
- Affected components: Chat endpoint, identity, QM sessions, approvals, alerts.
- Status: contract-ready; provider configuration blocked.
- Supersedes/superseded by: supersedes legacy alert-only architecture for QM; Slack connected-data remains optional.
- Rollback/correction: disable interactive app binding; retain alert adapter and immutable receipts.

## `ADR-HRMNY-20260829-006` — four memory authorities

- Decision/finding: keep harness memory, operational memory, GBrain company memory, and the operational system of record distinct.
- Reason: their trust, latency, provenance, deletion, and authority semantics differ.
- Alternatives: one shared vector store/database; direct QM/GBrain DB access.
- Trade-offs: governed projection and correction workflows add latency.
- Evidence: GBrain/memory audit; harness memory status; current `memory_chunk` implementation.
- Confidence/freshness: high.
- Affected components: memory, audit, QM, GBrain, portal.
- Status: accepted architecture.
- Supersedes/superseded by: supersedes generic shared-memory assumptions; none.
- Rollback/correction: disable projector, rebuild GBrain from approved sources, preserve operational records.

## `ADR-HRMNY-20260829-007` — GBrain isolation model

- Decision/finding: use a dedicated PostgreSQL+pgvector database, one source per genuine read-privacy boundary, read-only employee/QM clients, and a centralized write-only projector.
- Reason: slug prefixes fence writes but do not provide equivalent read privacy; raw DB access bypasses OAuth fences.
- Alternatives: shared source with prefixes; point GBrain at HRMNY DB; give QM DB URL.
- Trade-offs: more sources/clients and explicit grant reconciliation.
- Evidence: GBrain stable `v0.47.6.0` audit.
- Confidence/freshness: high for upstream behavior; deletion completeness remains a gap.
- Affected components: GBrain, projector, OAuth, backups, offboarding.
- Status: contract-ready; runtime not deployed.
- Supersedes/superseded by: supersedes generic `postgres-to-gbrain` graph edge; none.
- Rollback/correction: revoke clients, stop projector, rebuild from approved source repository.

## `ADR-HRMNY-20260829-008` — portal is a publication boundary

- Decision/finding: the portal is client-scoped and explicitly client-visible; it may perform only the documented small write allowlist through real portal identities and revocable server sessions.
- Reason: client ownership alone does not make internal/draft objects publishable; current identity and localStorage grant paths are unsafe.
- Alternatives: expose all client-tagged rows; make portal read-only; direct QM/GBrain access.
- Trade-offs: publication projections, session repair, and view receipts are required.
- Evidence: portal audit; governing plan.
- Confidence/freshness: high for current code findings.
- Affected components: portal auth, data projections, approvals, comments, onboarding, uploads.
- Status: accepted target; current implementation blocked from production acceptance.
- Supersedes/superseded by: resolves older read-only vs transactional conflict; none.
- Rollback/correction: disable portal writes/session issuance while preserving client records and audit.

## `ADR-HRMNY-20260829-009` — Sales external-effect contract

- Decision/finding: preserve the six-step loop; free discovery must not persist canonical CRM data; paid enrichment is exact-candidate/action-time approved; sends use an effect broker and never auto-send.
- Reason: current legacy paths can spend, fabricate, duplicate, or persist obfuscated/generic data without durable authority.
- Alternatives: generic approval allowance; direct provider calls from UI/jobs; auto-send.
- Trade-offs: more visible gates and slower throughput.
- Evidence: Sales audit, Sales cutover, official Apollo/Gmail docs.
- Confidence/freshness: high for code; Apollo credit amount may vary.
- Affected components: research, Apollo, Gmail, CRM, pipeline, learning.
- Status: accepted target; containment/implementation pending.
- Supersedes/superseded by: supersedes legacy `apolloImport`/daily pipeline as production path; none.
- Rollback/correction: disable provider adapter and retain drafts/receipts; never retry an uncertain paid call automatically.

## `ADR-HRMNY-20260829-010` — scheduler ownership

- Decision/finding: every path gets one scheduler owner and an atomic claim; Inngest owns approved durable code jobs, n8n bounded cross-provider glue, and repository schedules only explicit fallback/repository tasks.
- Reason: GitHub and Vercel currently call the same endpoint, while lead/report claims can race.
- Alternatives: keep overlapping schedulers; rely on check-then-marker.
- Trade-offs: cutover needs live enablement inventory and recovery proof.
- Evidence: testing/recovery and repository audits.
- Confidence/freshness: high for code; live scheduler enablement unqueried.
- Affected components: cron, Inngest, n8n, reports, Sales, reconciliation.
- Status: accepted principle; exact live cutover is a gap.
- Supersedes/superseded by: supersedes conflicting automation inventory claims; none.
- Rollback/correction: pause one owner and enable only the documented fallback after queue/readback verification.

## `ADR-HRMNY-20260829-011` — readiness and tests are inert by default

- Decision/finding: readiness GETs perform no writes; explicit policy repair couples its conditional update and audit atomically; ordinary tests deny live network/database/provider use; every live-proof invocation intrinsically requires a disposable allowlisted target, time-bounded receipt, exact confirmation, and production-ref denial.
- Reason: current readiness heals policy and test discovery can mutate any loaded database.
- Alternatives: rely on operator care or secret absence.
- Trade-offs: live acceptance becomes a deliberate separate workflow.
- Evidence: testing/recovery audit; `EVID-008` through `EVID-017`.
- Confidence/freshness: high.
- Affected components: readiness, Vitest, workflows, runtime pins.
- Status: implemented and locally verified; pull request pending.
- Supersedes/superseded by: supersedes environment-triggered live proof; none.
- Rollback/correction: revert code while keeping live workflows disabled; do not restore unsafe automatic behavior.

## `ADR-HRMNY-20260829-012` — acceptance and release discipline

- Decision/finding: no automatic merge/deploy; each slice ends in tests, graph/gap/decision/evidence updates, a reviewable PR, and explicit residual blockers.
- Reason: code/deployment/health do not equal provider, recovery, user, or production acceptance.
- Alternatives: one enormous completion change; auto-merge on CI.
- Trade-offs: more PRs and staged dependencies.
- Evidence: governing mission and historical incomplete acceptance.
- Confidence/freshness: high.
- Affected components: all delivery/release work.
- Status: active.
- Supersedes/superseded by: supersedes monolithic completion framing; none.
- Rollback/correction: close/revert the precise slice; preserve evidence and unresolved gaps.
