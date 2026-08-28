# Consolidated human gates

Reply with references or receipt IDs only—never secret values. One response can authorize several rows. An approval applies only to the exact target and effect named here.

## Blocking continuation gates

| ID | Exact reference, choice, or approval needed | What the next run will do |
| --- | --- | --- |
| G1 | A disposable **local** PostgreSQL URL reference for `MIGRATION_TEST_DATABASE_URL`, plus explicit permission to let `db:verify` drop/recreate only that named database. Confirm it contains no required data. | Run fresh and 0073→0074 upgrade migration verification, schema/RLS assertions, and application checks. No production DB. |
| G2 | Confirm the canonical release target: GitHub repo/ref, Vercel team/project, Supabase org/project/branch/region, migration owner, and whether I may push/open a PR, deploy a preview, and/or touch production. Each effect needs its own approval. | Verify remote diff/CI; then only the approved push/PR/preview/migration/deploy steps, with readback and rollback receipt. |
| G3 | Confirm database recovery: backup/PITR status reference, Storage-object backup route, direct migration connection reference, pooled runtime connection reference, and single production migration writer. | Review migration lock/runtime risk and execute only after G1 plus exact environment approval. |
| G4 | Legal finance reference for the real UAE TRN (`HRMNY_TAX_REGISTRATION_NUMBER`) and finance owner approval to display it on issued invoices. | Configure by reference, issue a synthetic/non-production invoice, read it back, then request any production invoice approval separately. |

## Integration account and asset gates

| ID | Exact reference, choice, or approval needed | Verification after configuration |
| --- | --- | --- |
| G5 | Xero app/secret refs, dedicated state-secret ref, webhook-key ref, exact organization/tenant ID, finance authorizer, and approval for read-only OAuth + webhook registration. Keep `XERO_WRITE_ENABLED=false`. | Intent-to-Receive, explicit tenant match, invoice mirror readback, linked paid reconciliation, revoke/reconnect drill. |
| G6 | Google Cloud project/OAuth-client refs, dedicated state-secret ref, consent-screen status, restricted-scope verification/security-assessment status, exact `@hrmny.co` pilot user, and reconnect approval. | Callback, identity binding, token refresh, read operations, approval-gated send, revocation. |
| G7 | Client-owned n8n base URL/project/user, API-key ref, inbound secret ref, **separate outbound secret ref**, exact Header Auth credential assets on both directions, and permission to import inactive workflows. Activation remains a second approval. | API health, pinned inbound success/invalid/replay/conflict, outbound proposal, approved synthetic execution, destination readback. |
| G8 | Composio organization/project/environment, API-key ref, webhook-secret ref, stable HRMNY user identity, auth-config ID, connected-account IDs, trigger/subscription choice, and allowed tools. | ACTIVE state, signed duplicate/conflict delivery, receipt, exact read tool, revoke/reconcile. |
| G9 | Inngest project plus event/signing-key refs and permission to sync `/api/inngest`; choose production vs preview. | Function discovery, one scheduled synthetic run, retry receipt, downstream report/lead state, cron de-duplication. |
| G10 | Sentry organization/project/region/environment, DSN refs, retention/PII policy, and—only if source maps are desired—org/project plus scoped auth-token ref. | Synthetic error, release/environment, scrubbed payload, source-map readback if enabled. |
| G11 | Resend account, verified domain/sender, API-key ref, recipient test mailbox, and send approval. | Provider acceptance, mailbox receipt, duplicate suppression, portal-session isolation. |
| G12 | Embedding provider choice (`none`, OpenAI, or OpenRouter), key ref, model, monthly cap, retention policy, and permission for one synthetic paid request. | Scoped semantic retrieval, cross-scope denial, usage receipt, delete/rebuild. |

## Paid CRM provider gates

| ID | Exact reference, choice, or approval needed | Flag that remains false until approved |
| --- | --- | --- |
| G13 | Apollo workspace/key ref, exact plan/operation eligibility, owner, synthetic target, and monthly credit cap. | `APOLLO_ALLOW_PAID_OPERATIONS` |
| G14 | Choose Hunter or NeverBounce, provide account/key ref, credit balance/cap, and two approved synthetic addresses. | `HUNTER_ALLOW_PAID_OPERATIONS` or `NEVERBOUNCE_ALLOW_PAID_OPERATIONS` |

## Source-gap and migration choices

| ID | Exact choice needed | Boundary |
| --- | --- | --- |
| G15 | Bayzat: keep approved CSV mirror, or provide a provider/tenant-issued official employee-list contract and account owner. | No guessed Bayzat API call will be implemented. |
| G16 | Asana cutover: exact workspace/project/resource GIDs, auth route, source snapshot/export, conflict policy, and whether HRMNY Work becomes authoritative. | No subscription or Asana write before preview and approval. |
| G17 | Meta/Google Ads: exact read-only accounts and scopes if M11 reporting is now in scope. | No campaign, audience, conversion, or spend write in this run. |

## Acceptance and recovery owners

| ID | Sign-off required | Receipt |
| --- | --- | --- |
| G18 | Ayham and Maolham choose pilot users and approve the UAT script/environment. | Role, CRM, Work, finance mirror, portal, automation, failure/recovery results signed separately. |
| G19 | Name the release owner, finance owner, security/privacy owner, provider-account owners, rollback owner, release window, and incident contact. | Ownership matrix stored without personal credentials. |
| G20 | If duplicate Vercel projects or stale provider assets should be archived/deleted, list exact IDs and approve each destructive action separately. | Pre-delete inventory, recovery/export evidence, post-delete readback. |

## Compact reply format

```text
G1 approved for disposable local DB ref <reference>; database contains no required data.
G2 push/PR: approved|not approved; preview deploy: approved|not approved; production: approved|not approved; refs: <references>.
G3-G20: <reference/choice/approval or “defer”>.
```

“Configured” means a reference exists. “Verified” additionally requires a successful least-privilege operation and canonical readback. Neither means user-accepted.
