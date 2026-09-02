# Reasons

Common scope/date/actor for every record: 2026-08-30;
`client-uae-creative-01/hrmny-os`; host `Bukhari-Laptop`; supervisor
`Codex /root`; tool/model `Codex agent (exact model ID not exposed)`; branch
`ahmadbukhari097/codex/phase-2-portal-approval-boundary-20260830`; implementation
commit `b2fea0bc9ae94e38595841783e177065a9a378d7`.

## `REASON-HRMNY-20260830-PORTAL-001` — approval is a client-owned effect

- Decision/finding: treat approval/rejection as a client-owned business effect,
  not a convenient workflow status update.
- Reason: it can release work and create downstream delivery obligations.
- Alternatives considered: treat staff preview and AI tools as delegated client
  authority.
- Trade-offs: internal users can prepare and preview but must wait for a real
  client principal to decide.
- Evidence: `ADR-HRMNY-20260830-PORTAL-001` through `-003`.
- Confidence/freshness: high; current architecture and tests.
- Affected components: authorization, approvals, audit, AI, Chat, staff preview.
- Status: adopted.
- Supersedes/superseded-by: none.
- Rollback/correction: a superseding ADR must preserve explicit client consent
  and immutable attribution.

## `REASON-HRMNY-20260830-PORTAL-002` — validate identity before object lookup

- Decision/finding: reject an invalid actor before querying or revealing the
  requested approval object.
- Reason: authorization ordering reduces cross-client existence disclosure and
  prevents mutation from preceding validation.
- Alternatives considered: load the object first; validate only the client ID
  embedded in the request.
- Trade-offs: unauthorized callers receive a stable generic refusal rather than
  object-specific diagnostics.
- Evidence: boundary and service regression tests.
- Confidence/freshness: high.
- Affected components: approval service and error mapping.
- Status: adopted and locally tested.
- Supersedes/superseded-by: none.
- Rollback/correction: retain authorization-first ordering during future query
  optimization.

## `REASON-HRMNY-20260830-PORTAL-003` — prompt wording is not authorization

- Decision/finding: enforce client write capability through typed execution
  surfaces and fixed allowlists; prompt classification is defense in depth
  only.
- Reason: paraphrases and wildcard custom-agent configuration can bypass a
  wording regex even when the visible approval tool is removed.
- Alternatives considered: expand the regex; trust custom-agent configuration;
  keep a model-selected generic action tool.
- Trade-offs: client-scoped free-form Chat is read-only until each desired
  effect has a reviewed typed command.
- Evidence: adversarial paraphrase and real custom-agent Chat tests, plus
  independent review receipt `EVID-HRMNY-20260830-PORTAL-006`.
- Confidence/freshness: high for the contained runtime surface.
- Affected components: generic agent tools, typed client draft commands, Chat,
  custom-agent configuration.
- Status: adopted and locally tested.
- Supersedes/superseded-by: strengthens `ADR-HRMNY-20260830-PORTAL-003`; none.
- Rollback/correction: add capability through exact typed wrappers and policy
  checks, never through prompt matching or wildcard expansion.

## `REASON-HRMNY-20260830-PORTAL-004` — terminal state requires durable evidence

- Decision/finding: consider a client campaign decision committed only when
  state, actor attribution, audit ID, and projection intent are committed
  together.
- Reason: a status without its receipt cannot be reconciled, corrected, or
  defended as a client-owned decision.
- Alternatives considered: best-effort audit/outbox writes after state change;
  recreate missing evidence on retry.
- Trade-offs: legacy unattributed terminal rows cannot be replayed as though
  they carried a verified client decision.
- Evidence: failure injection and concurrent decision tests in
  `EVID-HRMNY-20260830-PORTAL-002` and review in `-006`.
- Confidence/freshness: high locally; disposable PostgreSQL proof pending.
- Affected components: campaign state, audit, seam outbox, projector.
- Status: adopted and locally tested.
- Supersedes/superseded-by: none.
- Rollback/correction: repair or explicitly migrate legacy evidence under a
  separate approved procedure; never infer it silently.
