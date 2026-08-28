# Outcome ledger

Evidence states are intentionally separate: `planned → documented → authorized → configured → tested → deployed → provider_accepted → destination_verified → user_accepted`.

| Dimension | State | Evidence | Remaining gate |
| --- | --- | --- | --- |
| Harness | documented | Run `20260828T003923Z`; `latest.json` plus all 18 artifacts read and SHA-256 inventoried. | Generated catalog lacks an HRMNY topology; this package is the repository-specific reconciliation. |
| Code | tested locally | Typed adapters, routes, receipt store, finance reconciliation, scheduler, telemetry, CI, and tests in local branch diff. | Commit/push/PR approval. |
| Lint | tested locally | Monorepo ESLint completes with zero errors and zero warnings. | CI readback after push. |
| Typecheck | tested locally | All monorepo packages pass TypeScript. | CI readback after push. |
| Unit/contract tests | tested locally | 772 passed; 3 live-only tests intentionally skipped; zero failed across 151 files. Replay/conflict/signature/scope/billing negative paths included. | CI readback and approved live contract tests. |
| Production build | tested locally | Both Next.js/Turbo apps pass; main app generated 86/86 pages under explicit mock/memory configuration. | Preview deployment of exact SHA. |
| Browser e2e | tested locally with host limitation | One clean bridge-backed Chromium run passed 74/74. Native Windows Next dynamic response bodies hung despite direct handler success. A later immediate rerun reached 38 pass/36 fail after the host accumulated 29,363 loopback socket rows and Chromium returned `EADDRINUSE`; this is a transport-repeatability failure, not a second green receipt. | Fresh-runner/preview e2e, native deployed-adapter proof, and client UAT. |
| Migration 0074 | documented, not executed | SQL, journal, schema, security tests, and guarded fresh/upgrade verifier exist. | G1 disposable-local destructive permission; then G2/G3 production authority. |
| Deployment readiness | documented/tested locally | Build, CI jobs, env examples, runbooks, inert provider wiring. | Exact Vercel/Supabase refs and preview/deploy approval. |
| Existing public deployment | observed read-only | `https://hrmny-os.vercel.app/` and `/api/ready` returned HTTP 200 on 2026-08-28; readiness reported Supabase auth/database healthy and zero connection errors. This predates and does not contain the local branch changes. | Provider/control-plane SHA readback. |
| Xero | code tested | Signature/ITR/receipt/mirror/paid-reconciliation boundaries implemented. | App, tenant, secrets, ITR, mirror and revoke receipts. |
| Google Workspace | code tested | Dedicated state secret, least-privilege scopes, callback and negative tests. | Cloud client, scope review, pilot authorization and reconnect. |
| n8n | code tested | Two-direction secrets, required IDs, durable replay/conflict behavior, inactive exports. | Tenant refs, Header Auth assets, import, pin-test, activation approval. |
| Composio | code tested | Official HMAC plus durable ack-only receipt and conflict handling. | Project/auth-config/account/subscription/tool refs and live readback. |
| Apollo/Hunter/NeverBounce | code tested | Official paths, free probes, explicit mode and paid flags. | Account/plan/credits/cap plus one approved synthetic paid call. |
| Resend | code tested | Stable idempotency keys and conflict tests. | Verified sender/domain, send approval, provider and mailbox receipt. |
| Embeddings/memory | code tested | Explicit none/local/OpenAI/OpenRouter paths; no silent fallback; scope required. | Provider/cap/retention choice and scoped live fixture. |
| Inngest | code tested | Official serve route, functions, retries, and cron de-duplication. | Project keys, sync, execution and downstream receipt. |
| Sentry | code tested/inert | Official Next.js instrumentation, no default PII/tracing/replay. | Project/DSN/policy and synthetic event readback. |
| Bayzat | bounded source gap | API mode fails `UNVERIFIED_INTERFACE`; CSV remains supported. | Tenant/provider official contract or explicit CSV acceptance. |
| Reconciliation | tested locally | Inbox replay, Xero link/payment logic, job claims, and unit tests. | Live source/destination comparison and convergence receipt. |
| Recovery | documented | Code revert, secret rotation, scheduler fallback, provider revoke, DB forward-fix/restore runbooks. | Approved restore/revoke/rollback drills. |
| User acceptance | pending | No acceptance was inferred from local tests. | Ayham and Maolham sign the UAT ledger. |

## Local changes do not imply external state

No migration was applied, no workflow activated, no email sent, no provider credit consumed, no Xero object written, no public deployment changed, and no user/account/asset was altered during this run.

The failed back-to-back browser rerun is retained as a failure receipt. No operating-system TCP setting was changed and no process was force-terminated; local test servers were stopped normally.
