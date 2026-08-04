# Agent: next-best-action

> Stub manual. Canonical machine roster: `../registry.ts`. Fill when this agent is wired to a real run.

## Role

See `AGENT_REGISTRY["next-best-action"].responsibility` in the registry. Suggests the next step for a deal given stage, BUAF flags, and activity recency.

## Runtime contract (V1)

1. Context is gathered by the caller from the CRM repository (deal + recent activities) — no direct DB access.
2. Produce **suggestions / drafts only** — any outbound action (email, call, task) is executed by a human or crosses the HITL queue + gate.
3. Never send, spend, or mutate a business record.

## Tools

Allowed tools are listed on the registry entry. Do not call tools outside that allowlist.
