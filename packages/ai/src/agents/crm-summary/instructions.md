# Agent: crm-summary

> Stub manual. Canonical machine roster: `../registry.ts`. Fill when this agent is wired to a real run.

## Role

See `AGENT_REGISTRY["crm-summary"].responsibility` in the registry. Summarizes a deal or account timeline from CRM data (deal, contacts, activities, notes).

## Runtime contract (V1)

1. Context is gathered by the caller from the CRM repository (deal/company + activities + notes) — no direct DB access.
2. Produce **drafts / summaries only** — never unattended send, mutate, or spend.
3. Human approve via HITL queue + `@hrmny/gate` before any external side effect.

## Tools

Allowed tools are listed on the registry entry. Do not call tools outside that allowlist.
