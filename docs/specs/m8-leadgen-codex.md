# Spec: m8-leadgen/pipeline (for Codex)

Branch: `feat/m8-leadgen` (off latest `main`; rebase daily). Standing repo rule:
verify `git branch --show-current` before every commit and push immediately —
the worktree is shared.

Daily lead-gen pipeline: research → enrich → verify → BUAF score → morning
digest → HITL outreach send → reply-intent → deal transition. **AI proposes;
the gate disposes. No autonomous external send — send is always a gate
transition after a human approve (MASTER-PLAN-V2 M8, HITL through M12).**

## Owns files (exact — no other spec lists these)

New:
- `packages/integrations/src/apollo/leadsource.ts` — `LeadSourceAdapter` mock+live
- `packages/integrations/src/hunter/verification.ts` — `EmailVerificationAdapter` hunter+neverbounce mock+live
- `apps/web/src/server/leadgen/agent-run.ts` — `RunAgent` dep type + deterministic mock
- `apps/web/src/server/leadgen/dedupe.ts` — dedupe candidates into CRM
- `apps/web/src/server/leadgen/pipeline.ts` — `runDailyLeadGen(deps)` plain async fn
- `apps/web/src/server/leadgen/digest.ts` — morning-digest assembly
- `apps/web/src/server/leadgen/reply-intent.ts` — `intentToTransition` map + hook
- `apps/web/src/server/trpc/leadgen-router.ts` — outreach HITL procedures (importable module)
- `apps/web/src/server/inngest/leadgen-daily.ts` — thin Inngest wrapper over `runDailyLeadGen` (no-op export until `INNGEST_*` keys exist; keep the plain fn the real entry point)
- `packages/db/migrations/0059_outreach_items.sql`
- `packages/db/migrations/0060_lead_intel.sql`
- Co-located `*.test.ts` for leadsource, verification, dedupe, reply-intent, and the outreach gate flow

Append-only (add exports, do not restructure): `packages/integrations/src/index.ts`
(export the two new factories).

## Interfaces to build against (FROZEN — read, never edit)

- `packages/integrations/src/contracts.ts`: `LeadSourceAdapter`,
  `LeadSearchCriteria`, `LeadCandidate`, `EmailVerificationAdapter`,
  `EmailVerificationResult`, `EmailVerificationProvider`.
- `packages/integrations/src/composio/index.ts`: `createComposioStub`,
  `ComposioSendAdapter.sendAfterApproval`, `ComposioSendInput`,
  `ComposioSendResult`. Reuse for the send step — do not redefine it.
- `packages/ai/src/agent-io.ts`: `AgentRunInput`, `AgentRunOutput`,
  `AgentGateOutcome`, `ReplyIntent`, `ReplyIntentSchema`,
  `ReplyIntentClassification`, `CompetitorFinding`.
- `packages/gate/src/gates/marketing.ts`: `OUTREACH_TRANSITIONS`,
  `outreachLegalTransitionGate`, `outreachApproveBeforeSendGate`. Route every
  state change through `transition(...)` from `@hrmny/gate` (see `crm-routers.ts`
  for the `actorFromCtx` + `transition` call pattern).
- CRM repository (consume, do not edit the router or repository): import from
  `apps/web/src/server/crm/repository` — `listContacts`, `getContact`,
  `createContact`, `createCompany`, `createDeal`, `getDeal`, `listDeals`,
  `moveDealStage`, `pipelineStages`.

## Patterns to mirror (existing, copy the shape)

- Adapter mock/live/`resolveMode` + `IntegrationMisconfiguredError` fail-loud:
  `packages/integrations/src/{apollo,hunter}/index.ts`. Env: `APOLLO_MODE`,
  `APOLLO_API_KEY`, `HUNTER_MODE`, `HUNTER_API_KEY`, `NEVERBOUNCE_API_KEY`.
  `LeadSourceAdapter.searchLeads` maps to `POST /v1/mixed_people/search`;
  `enrichLead` maps to `/v1/people/match` (existing live Apollo shape).
  NeverBounce live: `GET https://api.neverbounce.com/v4/single/check`.
- `EmailVerificationAdapter` never invents a verdict — unknown stays `unknown`,
  `emailVerified:false` (verified-email is a payment-trigger deal transition).

## Deliverable (behaviour)

1. **`runDailyLeadGen(deps)`** (deps injected: `{ leadSource, verifier, runAgent,
   digestSink }`) — `searchLeads(criteria)` → `dedupeIntoCrm` → `verifier.verify`
   on each new email → `runAgent({ agent:"research", input:{lead} })` for BUAF
   score (consumes `AgentRunOutput`; M7 supplies the real runner, mock ships
   here) → `buildDigest(scoredLeads)`. Idempotent: re-running the same candidates
   creates no duplicate contacts.
2. **`dedupeIntoCrm(candidates)`** — match by `lower(email)` via
   `listContacts({ search })`; existing → skip, new → `createCompany` (by
   `companyDomain`) + `createContact` + `createDeal`; carry `externalId` in the
   contact/deal note. Returns `{ created, skipped }`.
3. **Outreach HITL** (`leadgen-router.ts`) — `draft` (outreach-draft agent
   output), `approve`, `send` procedures over the `outreach_items` table
   (state `draft→approved→sent`). `send` calls `transition(... to:"sent")`
   through the frozen outreach gates, then `composio.sendAfterApproval({toolkit:"gmail"})`.
   Blocked if not human-approved — assert this.
4. **Reply-intent hook** (`reply-intent.ts`) — `intentToTransition:
   Record<ReplyIntent,string|null>` maps a classified `ReplyIntent` to a target
   deal stage, applied via `moveDealStage`. `ponytail:` the map's stage ids are a
   calibration knob — tune against the real `pipelineStages()` values; `not_now`/
   `other` → `null` (no move); `unsubscribe` → lost/disqualified stage.
5. **Intelligence tables** (migrations) — `0059 outreach_items`
   (id, deal_id, channel, state, body, approved_by, sent_at, external_id,
   audit cols); `0060` `contact_edges` (from_contact, to_contact, relation,
   weight) + `win_loss_notes` (deal_id, outcome, note, embedding-ready text).
   RLS mirroring the M3 CRM tables.

## Migration slot

`0059`, `0060` — assigned by orchestrator. Do not self-number or touch any other
`00NN` file.

## Acceptance (must pass)

- `pnpm --filter @hrmny/integrations test` — leadsource + verification mock/live
  fail-loud + verdict-never-invented cases green.
- `pnpm --filter @hrmny/web test` — dedupe idempotency, `intentToTransition`
  mapping, and outreach gate flow (send blocked pre-approve, allowed post-approve)
  green, `LLM_PROVIDER=mock`.
- `pnpm --filter @hrmny/web typecheck` clean.
- Demo it enables: morning digest of N scored fresh leads; one approved send
  delivered via Composio stub; a reply classified and the deal auto-transitioned.

## Out of scope (DO NOT TOUCH)

- `apps/web/src/server/trpc/root.ts`, `trpc.ts` — orchestrator wires the router.
- `packages/ai/src/provider.ts` and any live LLM runner (M7 owns; inject via `RunAgent`).
- The frozen files listed above; `m3-routers.ts`, `crm-routers.ts`,
  `analytics-router.ts`, `campaigns-router.ts`; `packages/ai/src/agents/*`
  instruction content (M9).
- Any migration outside `0059`/`0060`. Any real send/publish/spend without a gate.
- Auto-send without HITL (V2).
