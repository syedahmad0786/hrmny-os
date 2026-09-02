# Decisions

Common record metadata: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
`Bukhari-Laptop`; actor `Codex /root`; tool/model `Codex agent (exact model ID
not exposed)`; branch
`ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; implementation
commit `41145c85e799f6b906dfca23a37aea0894cc9582`.

## `ADR-HRMNY-20260831-RESEARCH-001` — proposal precedes CRM identity

- Decision/finding: sourced capture creates a proposal, signal, audit event,
  and completed internal inbox receipt atomically; it creates no canonical CRM
  company, contact, or deal.
- Reason: research is evidence, not yet an approved operating identity.
- Alternatives considered: create a company immediately; keep capture only in
  browser state; retain the synthetic daily-research mutation.
- Trade-offs: an operator must complete Gate 1 before person discovery, but
  duplicate and unsupported CRM records are contained.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-001/002`.
- Confidence/freshness: high; reviewed against the implementation commit.
- Affected components: Sales research service, store, router, audit/inbox.
- Status: implemented locally; hosted and production acceptance pending.
- Supersedes/superseded-by: supersedes the hard-coded daily research path;
  none.
- Rollback/correction: revert the reviewed commit without restoring automatic
  company creation; preserve existing records.

## `ADR-HRMNY-20260831-RESEARCH-002` — Gate 1 fails closed

- Decision/finding: promotion requires a completed proposal receipt and an
  unlinked source signal, resolves only unambiguous name/domain identity, and
  links the exact eligible signal count inside one transaction.
- Reason: approval cannot repair missing lineage or silently merge competing
  identities.
- Alternatives considered: name-only merge; domain-only merge; best-effort
  signal linking after commit.
- Trade-offs: uncertain matches require manual review and may delay a lead.
- Evidence: concurrency, conflict, receipt, and rollback tests in
  `EVID-HRMNY-20260831-RESEARCH-002`.
- Confidence/freshness: high for memory behavior; PostgreSQL execution pending.
- Affected components: Gate 1, identity resolution, company/signal persistence.
- Status: implemented and locally tested.
- Supersedes/superseded-by: refines the accepted Sales Growth Gate 1 contract;
  none.
- Rollback/correction: preserve fail-closed errors and correct forward with new
  deterministic conflict fixtures.

## `ADR-HRMNY-20260831-RESEARCH-003` — evidence must be plausibly public HTTPS

- Decision/finding: source evidence accepts HTTPS only and rejects credentials,
  placeholder subdomains/suffixes, non-public names, and non-public IPv4/IPv6
  address classes.
- Reason: an approval surface must not present an internal, fake, or unsafe URL
  as public research proof.
- Alternatives considered: accept any URL; allow HTTP; perform live fetches
  during capture.
- Trade-offs: syntactically public evidence can still be irrelevant or stale,
  while live availability checks remain a separately governed operation.
- Evidence: source-validation matrix in
  `EVID-HRMNY-20260831-RESEARCH-002`; open relevance gap
  `GAP-HRMNY-20260831-RESEARCH-006`.
- Confidence/freshness: high for syntactic/network-space policy.
- Affected components: research evidence validator and proposal capture.
- Status: implemented; semantic/provider acceptance open.
- Supersedes/superseded-by: none.
- Rollback/correction: extend deny classes and fixtures; never weaken to accept
  arbitrary URLs without an ADR.

## `ADR-HRMNY-20260831-RESEARCH-004` — use provisioned operator roles

- Decision/finding: research and Apollo mutations are limited to Partner,
  Director, AM, and Account Manager; no invented `sales` role is accepted.
- Reason: authorization must derive from provisioned HRMNY principals.
- Alternatives considered: add a browser-only Sales role; make CRM membership
  sufficient; leave reads unrestricted.
- Trade-offs: a future dedicated Sales role needs an explicit provisioning and
  policy change.
- Evidence: role-gate tests and independent review
  `EVID-HRMNY-20260831-RESEARCH-003`.
- Confidence/freshness: high for current repository role vocabulary.
- Affected components: Sales router and intent/Apollo operations.
- Status: implemented and locally tested.
- Supersedes/superseded-by: removes unsupported role assumptions; none.
- Rollback/correction: update identity provisioning and server policy together,
  with denial regression tests.

## `ADR-HRMNY-20260831-RESEARCH-005` — separate provider and synthetic inputs

- Date/scope/actor: 2026-08-31; `client-uae-creative-01/hrmny-os`; host
  `Bukhari-Laptop`; actor `Codex /root`; exact model ID not exposed; branch
  `ahmadbukhari097/codex/phase-4-sales-research-proposals-20260830`; commit
  `762ffec1ca78137ed0d86778965abae7bb699010`.
- Decision/finding: disconnected Apollo fields remain disabled; the collapsed
  acceptance tools use a separate, clearly labeled synthetic-company input
  available only when the complete inert synthetic-runtime policy passes.
- Reason: test fixtures must not require, enable, or visually impersonate the
  real provider surface.
- Alternatives considered: re-enable mock Apollo on the normal field; delete
  downstream browser coverage; silently seed a fixed company.
- Trade-offs: acceptance tests perform one extra explicit input step, while
  provider truth and synthetic lineage stay unambiguous.
- Evidence: `EVID-HRMNY-20260831-RESEARCH-011/012`.
- Confidence/freshness: high.
- Affected components: Hunt provider form, synthetic tools, downstream Sales
  and delivery browser journeys.
- Status: implemented and duplicate hosted browser accepted.
- Supersedes/superseded-by: refines the synthetic containment portion of
  `ADR-HRMNY-20260831-RESEARCH-001`; none.
- Rollback/correction: preserve separate state and labels; never make a real
  provider field writable merely to support fixtures.
