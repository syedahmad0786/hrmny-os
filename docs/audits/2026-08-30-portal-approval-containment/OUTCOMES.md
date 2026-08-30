# Outcomes

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`; implementation
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`.

## `OUTCOME-HRMNY-20260830-PORTAL-001` — client decision authority contained

- Decision/finding: staff preview, AI, Chat, stale aliases, wildcards, and the
  legacy executor cannot record a client approval decision; a verified same-
  client portal principal remains the only accepted actor.
- Reason: close the audited P0 without a schema migration or destructive route
  removal.
- Alternatives considered: defer the P0; rebuild the full portal in one change.
- Trade-offs: canonical magic-link behavior is locally proven, while hosted
  session acceptance and broader portal workflows remain explicit gaps.
- Evidence: `EVID-HRMNY-20260830-PORTAL-001` through `-008`.
- Confidence/freshness: high for local code/test containment.
- Affected components: portal approvals, staff preview, AI/Chat, audit.
- Status: implemented and locally verified; CI/merge/deployment pending.
- Supersedes/superseded-by: supersedes the unsafe approval reachability portion
  of the Phase 0 gap; none.
- Rollback/correction: retain an equivalent client-only authority boundary in
  every forward fix or reviewed revert.

## `OUTCOME-HRMNY-20260830-PORTAL-002` — no live operational acceptance claimed

- Decision/finding: no production database, provider, deployment, migration,
  client message, named user, or live client was used.
- Reason: keep code proof distinct from operational acceptance.
- Alternatives considered: collapse a healthy build into “complete.”
- Trade-offs: deployment, recovery, UAT, and production acceptance remain
  separate phases.
- Evidence: acceptance-state table and local command receipts.
- Confidence/freshness: high.
- Affected components: release governance.
- Status: explicitly not deployed/provider accepted/destination verified/
  recovery verified/user accepted/production accepted.
- Supersedes/superseded-by: none.
- Rollback/correction: advance one acceptance state only with its own receipt.

## `OUTCOME-HRMNY-20260830-PORTAL-003` — canonical local sessions replace pseudo identities

- Decision/finding: magic-link request, invite, verification, grant resolution,
  development personas, and action-time guards now use the same canonical
  portal-user identity; local deactivation revokes subsequent grant resolution.
- Reason: make the client actor stable, attributable, and revocable before any
  approval mutation.
- Alternatives considered: deterministic IDs and allowlist-only authorization.
- Trade-offs: hosted Supabase/cookie acceptance remains open.
- Evidence: focused magic-link, session-isolation, and boundary tests.
- Confidence/freshness: high locally.
- Affected components: portal authentication and approvals.
- Status: implemented and locally verified; not deployed/provider accepted.
- Supersedes/superseded-by: supersedes the former pseudo-identity path; none.
- Rollback/correction: preserve canonical resolution in all forward fixes.

## `OUTCOME-HRMNY-20260830-PORTAL-004` — decisions and projection intents are recoverable

- Decision/finding: creative approval uses a distinct `creative.approved`
  receipt after QC; campaign approval/rejection stores explicit client actor,
  decision time, feedback, audit ID, and pending projection intent. Exact
  replays reconcile; conflicts preserve the first decision.
- Reason: distinguish internal quality review from client consent and make
  downstream work traceable.
- Alternatives considered: reuse the QC event; emit best-effort notifications
  without durable intent.
- Trade-offs: unattended outbox retry/dead-letter and disposable database proof
  remain open.
- Evidence: focused failure/replay/concurrency tests and independent review.
- Confidence/freshness: high locally; medium-high for compiled database path.
- Affected components: creative, campaigns, portal approvals, audit/outbox.
- Status: implemented and locally verified; operational acceptance pending.
- Supersedes/superseded-by: none.
- Rollback/correction: preserve separate QC/client receipts and atomic campaign
  attribution in any correction.
