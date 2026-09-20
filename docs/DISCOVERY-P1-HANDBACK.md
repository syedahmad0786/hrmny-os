# Discovery release handback — 21 September 2026

Implementation and bounded repairs are locally verified. Discovery is not yet deployed or operationally accepted. Cursor owns ordinary implementation; Codex owns independent review, release and live acceptance. All product writer leases have returned to the coordinator.

## Final behavior

- Job-global call/token reservations are stored under the job lock before model I/O. Stale in-flight outcomes become explicitly uncertain and cannot automatically replay. The eight-call ceiling remains; 2,400-token reservations naturally admit at most five calls within 12,000 tokens.
- The live request enforces a 1,600-byte serialized-message ceiling, a 400-token framing/schema allowance and a 400-token output limit. Oversized input is refused before network I/O.
- Receipt persistence failure stops automatic continuation across every source in the job, preserves unattempted observations, and keeps the shared error visible. Recovery is deliberate cancellation followed by a new run; uncertain reservations are not silently refunded.
- Cancellation selects unfinished source queues first and can finalize when all queues were already terminal. Candidate writes remain forbidden after cancellation; attempt/generation and replay checks remain intact.
- Review reload retrieves source-bound automated identity provenance from the owning durable job, including real model/request IDs. Manual lineage is derived only from durable submissions with no scheduled job. Missing provider IDs stay null. Review reads make no model calls.
- Public Discovery inference alone permits `nex-agi/nex-n2.5-pro:free`, pins `Nex AGI`, prohibits fallback/plugins/web/private context, and requires observed upstream/model and actual reported cost zero. Shared development/private routing is unchanged. Price proof expires after 48 hours and fails closed.
- LF rules for migrations 0085–0087 preserve identical Windows and Linux release bytes. No SQL semantics changed.
- Global execution and interpretation remain disabled. Pausing does not mutate queues. Native n8n Header Auth/JWT, observation limits, provider timeout and deterministic default evaluation remain intact.

## Verification

Serial checks after the final bounded changes: interpretation/callback unit tests 25/25; AI provider tests 28/28; isolated PostgreSQL callback proofs 7/7; web TypeScript and diff checks passed. Earlier candidate/manual-provenance and callback database proofs also passed before the final routing-only changes.

An independently inspected application-schema backup restore applied the exact LF 0085–0087 files in a new local database: journal 87 to 90; employee/client/inbox/job counts 23/75/59/27 preserved. Migration 0087 SHA-256 is `e5d3262ea5541d5f629766df449fb1e15c600d677bed20381958bebb478c7bc2`. Full Supabase-managed restore/PITR remains unproved.

Separate live evidence: native n8n header rejection/signing transport passed; one public Campaign ME identity request through exact Nex AGI returned grounded `talabat`, domain null and actual cost zero. These prove individual capabilities, not operational Discovery acceptance. Detailed redacted receipts live in the existing coordination package.

## Release and acceptance still required

Exact-head CI and reviewed merge; guarded additive production migration; owner CLI execution-disabled staging and readback; deployed intended-role programme/review UI; actual source-to-tenant ingestion, durable results, complete required source coverage, unattended schedules and recovery; controlled activation. No next module implementation until Discovery is accepted.

The 48-hour price-proof refresh needs an operational owner/process. Upstream and actual-cost proof currently resides in the external receipt; candidate lineage preserves OpenRouter/model/request identity. The two unused n8n test credentials remain intentionally at the user's request.
