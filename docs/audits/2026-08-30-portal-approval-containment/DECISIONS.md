# Decisions

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`; implementation
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`.

## `ADR-HRMNY-20260830-PORTAL-001` — only a verified client principal may decide

- Decision/finding: a portal approval decision requires a portal actor with
  `portal:approve`, the same client scope, and an active canonical
  `client_portal_user` row revalidated at action time inside the transaction.
- Reason: staff, agents, display names, and stale session claims cannot stand in
  for the client whose decision is being recorded.
- Alternatives considered: trust the route middleware alone; accept an
  employee ID in the service; preserve AI approval with an allowlist.
- Trade-offs: local magic-link grants now resolve canonical users, but the
  hosted Supabase/cookie path remains unaccepted until isolated integration
  and revocation proof.
- Evidence: `EVID-HRMNY-20260830-PORTAL-001`, `-002`, and `-006`.
- Confidence/freshness: high; verified against the implementation commit.
- Affected components: portal procedure, approval service, audit attribution,
  task mutation, approval event seam.
- Status: implemented and locally tested; merge/deployment pending.
- Supersedes/superseded-by: implements the containment boundary proposed by
  `ADR-HRMNY-20260829-008`; none.
- Rollback/correction: keep staff and agents unable to record client decisions;
  correct forward or use the reviewed rollback runbook.

## `ADR-HRMNY-20260830-PORTAL-002` — staff preview is read-only

- Decision/finding: retain the compatibility mutation name but return a typed
  refusal before lookup or mutation; remove staff decision controls and label
  the page as a read-only partner preview.
- Reason: route deletion requires a broader dependency and migration review,
  while leaving the existing behavior would impersonate a client decision.
- Alternatives considered: delete the route; hide controls only; permit staff
  approval with an audit note.
- Trade-offs: one intentionally denied compatibility endpoint remains visible
  in the API inventory.
- Evidence: `EVID-HRMNY-20260830-PORTAL-002`, `-006`, and `-008`.
- Confidence/freshness: high; current implementation and focused tests.
- Affected components: staff preview UI, `clientPreview.act`, API inventory.
- Status: implemented and locally tested.
- Supersedes/superseded-by: partially supersedes the unsafe behavior recorded
  in `GAP-HRMNY-20260829-PORTAL-001`; none.
- Rollback/correction: do not restore a staff-authored decision path; a future
  removal requires inventory, dependency, migration, and rollback approval.

## `ADR-HRMNY-20260830-PORTAL-003` — agent and Chat decisions are unavailable

- Decision/finding: remove the portal decision tool from default AI/Chat
  surfaces, filter all known stale aliases from effective custom-agent
  allowlists, make generic client agent execution and client Chat read-only,
  remove model-selected `agent_act`, and keep the old executor as an inert
  compatibility refusal.
- Reason: an agent may prepare evidence or advance work to client review but
  cannot become the client approval authority.
- Alternatives considered: retain the tool behind prompt wording; approve via
  wildcard allowlists; delete historical custom-agent configuration.
- Trade-offs: stored stale strings remain for non-destructive compatibility,
  but resolve to no capability at runtime; free-form Chat cannot perform client
  writes until a typed effect-broker command is separately reviewed.
- Evidence: `EVID-HRMNY-20260830-PORTAL-002` and `-006`.
- Confidence/freshness: high; direct, alias, wildcard, seeded-agent, and Chat
  tests are green.
- Affected components: AI tools, custom-agent allowlists, Chat tools, mock AI
  provider, seeded instructions, settings copy.
- Status: implemented and locally tested.
- Supersedes/superseded-by: supersedes AI-authored portal approval behavior;
  none.
- Rollback/correction: keep the compatibility refusal even if UI metadata is
  reverted; any future automation requires a separate non-decision workflow.

## `ADR-HRMNY-20260830-PORTAL-004` — approval retries are idempotent

- Decision/finding: a replay of an already-resolved approval returns
  `changed:false` before adding another audit record, event seam, notification,
  or downstream state transition.
- Reason: retries and duplicate requests must not manufacture multiple client
  decisions or effects.
- Alternatives considered: audit every replay as another decision; rely on the
  caller to suppress duplicates.
- Trade-offs: retry observability must come from request/inbox telemetry rather
  than a duplicate business-decision audit row.
- Evidence: `EVID-HRMNY-20260830-PORTAL-002`.
- Confidence/freshness: high; regression test asserts effect counts.
- Affected components: portal approval service, audits, task/asset transition,
  approval seam.
- Status: implemented and locally tested.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve the idempotency boundary; add a separate retry
  receipt if operational telemetry is required.

## `ADR-HRMNY-20260830-PORTAL-005` — canonical magic sessions are resolved, not inferred

- Decision/finding: an invited email and client must resolve to exactly one
  active canonical `client_portal_user`; every grant lookup resolves that user
  again rather than trusting a deterministic pseudo ID or stale claim.
- Reason: approval attribution, offboarding, and revocation require a stable
  server-owned principal.
- Alternatives considered: hash the email into an identity; trust allowlist
  membership alone; keep a stale principal in the grant.
- Trade-offs: zero or duplicate active matches fail closed, and the production
  delivery/cookie path remains a separate acceptance gap.
- Evidence: magic-link, session-isolation, canonical-boundary, and revocation
  tests in `EVID-HRMNY-20260830-PORTAL-002`.
- Confidence/freshness: high for local/synthetic behavior; medium for hosted
  behavior until isolated Supabase acceptance.
- Affected components: portal invite, magic-link request/verify, grant
  resolution, development portal personas, offboarding.
- Status: implemented and locally tested; provider/deployment acceptance
  pending.
- Supersedes/superseded-by: supersedes the pseudo-identity behavior in the
  Phase 0 audit; none.
- Rollback/correction: never restore deterministic pseudo identities; correct
  canonical data or session plumbing forward.

## `ADR-HRMNY-20260830-PORTAL-006` — campaign decisions commit with their receipts

- Decision/finding: a campaign decision, portal-attributed audit, and pending
  seam intent commit together. PostgreSQL locks the principal and item inside
  one transaction; memory mode stages all three locally and publishes them
  synchronously. Exact retries re-drive the locked projector, while opposite
  decisions or changed rejection feedback return a conflict.
- Reason: terminal state without immutable evidence is not an accepted client
  decision.
- Alternatives considered: mutate first and audit later; best-effort global
  outbox writes; rely on caller-side deduplication.
- Trade-offs: historical terminal campaign rows without explicit attribution
  fail closed, and the outbox still needs operational retry/dead-letter
  hardening.
- Evidence: replay, audit-failure, projector-failure, same-item concurrency,
  and cross-item failure tests plus independent adversarial review.
- Confidence/freshness: high for memory-mode semantics and compiled SQL;
  medium-high overall until disposable PostgreSQL concurrency proof.
- Affected components: campaign repository, portal approval router, audit,
  feedback, staff notification, seam outbox.
- Status: implemented and locally tested; database integration proof pending.
- Supersedes/superseded-by: hardens `ADR-HRMNY-20260830-PORTAL-004`; none.
- Rollback/correction: preserve atomic state-plus-receipt semantics in any
  forward fix; never fabricate attribution for historical rows.
