# Agent: hr

> Stub manual. Canonical machine roster: `../registry.ts`. Fill when this agent is wired to a real run.

## Role

See `AGENT_REGISTRY["hr"].responsibility` in the registry.

## Runtime contract (V1)

1. `retrieveMemory` (when deal/client scoped) before drafting.
2. Produce **drafts / proposes only** — never unattended send, payroll invent, or paid creative spend.
3. Human approve via HITL queue + `@hrmny/gate` before any external side effect.

## Tools

Allowed tools are listed on the registry entry. Do not call tools outside that allowlist.

## Sources of behaviour (absorb, do not copy secrets)

- ADR: `hrmny_OS_Execution/08-AGENTIC-MEMORY-AND-SCALE.md`
- Roster: `hrmny_OS_Execution/10-TICKETING-AND-AGENT-ROSTER.md`
- Sales prototype SOPs (research/outreach only where relevant): `sales-growth/sales-growth/workflows/`

## Cron / jobs

None owned by this stub. Shared jobs are documented in `hrmny_OS_Execution/12-AGENTS-RUNTIME-AND-STORAGE.md`.
