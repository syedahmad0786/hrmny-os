# Decisions, reasons, tradeoffs, and failures

Recorded during harness run `20260828T003923Z`. These are repository-local decisions, not provider or client acceptance.

## Constraints preserved

| Constraint | Decision and reason |
| --- | --- |
| No destructive action without approval | Migration verification is guarded by an explicit `MIGRATION_TEST_ALLOW_DROP=true` flag and a local-only URL check. It was not run because it drops/recreates a disposable database. |
| No external or production writes | No push, pull request, deployment, provider configuration, workflow activation, message, invoice, or tenant mutation was performed. |
| Secrets by reference only | Only environment-variable names and declared store boundaries were inspected. No `.env` values or unrelated vaults were read. |
| Xero read-only | `XERO_WRITE_ENABLED=false` remains the operational lock. Payment state can only arrive through canonical Xero readback. |
| Paid operations need a separate gate | Apollo enrichment/search and Hunter/NeverBounce verification require explicit per-provider approval flags even when a key exists. |
| Client and employee isolation | Inbound receipts are provider/event scoped and memory search now requires an explicit client, employee, deal, company, or task scope. |

## Material decisions

1. **Use the canonical clean worktree.** The OneDrive project contains historical and damaged nested checkouts. Safe implementation continued in a dedicated git worktree on `ahmadbukhari097/codex/system-harness-hrmny-completion`, preserving every user-owned dirty directory.

2. **Treat the generated harness as a planning baseline.** The harness ran successfully and every artifact was read. Its scanner follows the OneDrive project root, so it sees legacy Vite/Netlify copies and emits generic all-pairs bridge gaps. We retained those source gaps but reconciled delivery against the declared canonical repo rather than pretending the generated score represented current code.

3. **Durability before acknowledgement.** Non-handshake Xero, n8n, and Composio events must enter `integration_inbox` before success. Provider event ID plus raw-body hash distinguishes a replay from conflicting ID reuse. Tradeoff: a database outage returns retryable failure instead of dropping a valid event.

4. **Keep Xero canonical and remove paid simulation.** The staff-facing `markPaidFromWebhook` mutation and its UI button were removed. Scheduled mirror sync links by Xero external ID and advances only `issued → paid` when the canonical read says `PAID`. Tradeoff: demos cannot fake payment, which is the intended financial boundary.

5. **Add migration 0074 as an additive forward change.** It creates the receipt inbox and invoice metadata/FKs without deleting data. A fresh-and-upgrade verifier was added, but execution requires explicit permission because it drops a named disposable local database.

6. **Never infer live mode from a paid-provider key.** Apollo and verification providers stay mock until their mode is explicit; credit-bearing operations additionally require a billing flag. This separates secret availability from authority to spend.

7. **Use provider-specific OAuth state secrets.** Google Workspace and Xero each require a dedicated 32-character state secret. Cross-provider, JWT, cron, and development-constant fallbacks were removed to avoid secret-domain collapse.

8. **Reduce Google scopes to evidenced operations.** Gmail is read/send, Calendar is read-only, Drive uses `drive.file` plus read-only discovery. Google restricted-scope verification and reconnect consent remain external gates.

9. **Use official Apollo and NeverBounce paths.** Apollo calls `/api/v1/...`; NeverBounce calls versioned `/v4/single/check`, not the stale `/v4.2` claim in the previous audit. Credential probes use non-credit health/account endpoints.

10. **Do not invent a Bayzat API.** No public official employee-list contract was verified. CSV remains the bounded source; API mode reports `UNVERIFIED_INTERFACE` until HRMNY supplies a tenant/provider contract.

11. **No silent embedding substitute.** The memory path supports `none`, explicitly allowed local development vectors, OpenAI, or OpenRouter. A failed live call does not silently produce a deterministic hash that could be mistaken for provider-backed semantics.

12. **Make portal persistence fail closed.** When `DATABASE_URL` is configured, magic-token insert/read errors surface. Runtime DDL and fallback to process memory were removed. Memory is allowed only when no database is configured.

13. **Wire Inngest without double scheduling.** The official Next.js serve handler and two functions were added. Existing signed cron remains the fallback, but skips the same lead/report jobs when both Inngest keys are configured.

14. **Wire Sentry inertly.** Official Next.js instrumentation is present, with PII/tracing/replay disabled in this slice. DSN and source-map release configuration remain separate account/deployment gates.

15. **Require email idempotency.** Every Resend send receives a stable idempotency key; mock behavior detects conflicting key reuse. This is stronger than retrying an unkeyed external send.

16. **Turn lint into evidence.** Package lint stubs were replaced by ESLint 10, CI now runs lint, and all warnings were resolved. This exposed and repaired unstable hook dependencies and several dead assignments without changing the product contract.

17. **Make local database intent explicit.** `DATABASE_MODE=memory` prevents a developer or CI acceptance run from inferring database authority from an unrelated loaded URL. Database-backed execution remains fail-closed and separately verified.

18. **Keep the Windows acceptance adapter test-only.** Direct route and tRPC handlers returned complete bodies, while both `next dev` and `next start` on this Windows host emitted dynamic headers and then stalled their bodies. The checked-in bridge invokes the same handlers, serves built artifacts, preserves security headers, and does not replace Vercel/Next production serving.

19. **Retain the browser rerun failure.** The clean bridge-backed run passed 74/74. An immediate later rerun exhausted Windows loopback tuples because the reliable workaround closes each response; 29,363 port-3500 socket rows were observed and Chromium returned `EADDRINUSE`. Experimental keep-alive/static-origin variants were reverted to the proven adapter. Acceptance must be repeated on a fresh runner or approved preview, not inferred from the failed rerun.

20. **Keep pasted n8n test keys in mock mode.** A credential reference is not activation. Process-memory keys remain mock unless `N8N_MODE=live`; live REST and webhook calls use an eight-second abort, and outbound webhooks still require the dedicated OS-to-n8n secret.

## Failures encountered and resolved

| Failure | Cause | Resolution |
| --- | --- | --- |
| Initial harness output had an unconfirmed client and shallow stack | Unconfigured project contract | Declared systems of record, canonical repo/worktree, stack, environments, URLs, and safety policy; reran as `20260828T003923Z`. |
| Harness still asked for hosting and unrelated pairwise bridges | It scans multiple historical nested projects and its reviewed topology catalog has no HRMNY match | Recorded the catalog limitation; used repository evidence and HRMNY-specific contracts, without editing the shared catalog. |
| Connection unit test reached a real n8n URL and received 401 | New fail-closed credential probe was not mocked in the test | Stubbed `fetch` in that test; production probe remains live and fail-closed. |
| Invoice issue tests failed after removing fabricated TRN | Tests had relied on an implicit fake legal identifier | Added an explicit 15-digit test-only fixture in invoice-issuance suites; production still requires `HRMNY_TAX_REGISTRATION_NUMBER`. |
| First lint cleanup caused missing `employeeId` type errors | A broad patch removed the wrong same-shaped local declaration | Restored the required declaration, removed the actual unused one, reran lint/typecheck. |
| Standard `python` could not import the harness | Shell resolved to a Hermes venv without the module | Used the installed Python 3.13 runtime with the verified catalog root on `PYTHONPATH`. |
| Native local Next server sent dynamic headers but not response bodies on Node 22 and 24 | Windows-local Next adapter transport; direct handlers and static files remained healthy | Added a bounded local-only acceptance bridge and preserved native deployed-adapter verification as an external preview gate. |
| Immediate second Chromium suite collapsed after 28 scenarios | Forced-close bridge traffic left 29,363 loopback socket rows; new connections returned `EADDRINUSE` | Stopped local servers normally, made no OS/network changes, restored the already-proven adapter, and documented a fresh-runner requirement. The clean receipt remains 74/74; the rerun remains failed. |
| Memory handover could create a duplicate first-creative task | Replay path always appended instead of reconciling the existing client/title/kind task | Reuse the canonical task and added a replay regression test. |
| Approval result disappeared when the queue advanced | Feedback was rendered only inside the current-queue branch | Persist the latest human-gated outcome after the queue becomes empty. |

## Recovery and rollback decisions

- Code rollback is a normal revert of this unpushed branch; no external state was changed.
- Migration 0074 has no automatic down migration because dropping receipt/audit data would be destructive. Recovery is restore/forward-fix after a reviewed database backup.
- Provider recovery is revoke/rotate/disable plus canonical readback; it is not “delete local row and assume disconnected.”
- Scheduler recovery is disable Inngest keys or pause the provider functions, then retain signed cron as the single runner; never run both for the same job.
- Webhook recovery is rotate only the relevant dedicated secret and replay retained provider events by stable ID.
