# `docs/specs/` — per-task specs for parallel agents

Every task handed to Codex, Cursor, or Grok gets one spec file here, on the
workstream branch, before code is written. Claude Code (orchestrator) writes the
specs, reviews the output, and is the only agent that merges to `main`. See
`docs/AGENT-WORKSTREAMS.md` for the full build architecture (§6 is the source of
this template).

## Template

Copy this into `docs/specs/<workstream>-<task>.md`:

```
# Spec: <workstream>/<task>
Branch: feat/<workstream>
Owns files: <exact paths>
Interfaces to build against: <types.ts / contracts.ts / registry.ts references — frozen, do not edit>
Migration slot (if any): <00NN, assigned by orchestrator>
Deliverable: <code + tests>
Acceptance: <command(s) that must pass; demo step it enables>
Out of scope: <explicitly>
```

## Rules

- **Owns files** are exact paths. Two specs never list the same file. The
  ownership map in `AGENT-WORKSTREAMS.md` §3 is authoritative on collisions.
- **Interfaces to build against** are frozen by the contract-freeze PR. Do not
  edit them from a workstream branch:
  - Adapter contracts — `packages/integrations/src/contracts.ts`
    (`LeadSourceAdapter`, `EmailVerificationAdapter`, `SocialPublishAdapter`,
    `AdsInsightsAdapter`) and the existing `packages/integrations/src/types.ts`
    (including `ComposioAdapter.sendAfterApproval` for HITL email/LinkedIn send).
  - Agent I/O — `packages/ai/src/agent-io.ts` (`AgentRunInput`,
    `AgentRunOutput`, `CompetitorFinding`, `ReplyIntent`).
  - Gate transitions — `packages/gate/src/gates/marketing.ts` (`outreach`,
    `campaign`, `portal_item` entity gate sets), registered in
    `packages/gate/src/bootstrap.ts`.
  - Stub routers to fill in — `apps/web/src/server/trpc/campaigns-router.ts`,
    `analytics-router.ts` (signatures frozen; mock data swaps for live).
- **Migration slots**: only the orchestrator assigns `00NN` numbers (currently
  at 0057). Request a slot in the spec; never self-number.
- **appRouter composition + `trpc.ts`**: orchestrator-only. Workstreams deliver
  routers as importable modules; the orchestrator wires them into `root.ts`.
- **Acceptance** must be a runnable command (e.g. `pnpm --filter @hrmny/gate test`)
  plus the demo step it unlocks. No untested code merges; CI runs
  `LLM_PROVIDER=mock`.
- Standing repo rule: verify `git branch --show-current` before every commit and
  push immediately — the local worktree is shared across sessions.
