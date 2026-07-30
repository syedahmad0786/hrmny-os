# Spec: m9-content/instruction-sets (for Grok)

Branch: `feat/m9-content` (off latest `main`; rebase daily). Verify
`git branch --show-current` before every commit; push immediately (shared worktree).

**HARD RULE: Grok edits Markdown only. Never edit, add, or delete any `.ts`,
`.tsx`, `.sql`, or config file. No new agent ids (that is a `registry.ts` change
— out of bounds).** Deliverable is agent instruction content + a rationale doc.
The instruction files are the system prompts a live model runs at M7/M8/M9;
write them on-voice, HITL-aware, and aligned to the frozen output shapes.

## Owns files (exact — Markdown only)

- `packages/ai/src/agents/creative/instructions.md` — rewrite/extend
- `packages/ai/src/agents/outreach-draft/instructions.md` — rewrite/extend
- `packages/ai/src/agents/research/instructions.md` — rewrite/extend, **plus a
  Competitor-Research mode** (a section inside this file — not a new agent)
- `docs/specs/m9-prompt-rationale.md` — new: rationale + the on-voice review checklist

## Interfaces to write against (FROZEN — reference by name, never edit)

These are `.ts` files you READ to keep the prose aligned; do not open them to edit.

- `packages/ai/src/agent-io.ts`:
  - `CompetitorFinding` — the Competitor-Research mode must instruct the model to
    emit findings matching this exact shape (`competitor`, `source` ∈
    `site|social|ads_library|other`, `headline`, `detail`, `url?`, `capturedAt`
    ISO, `scopeId?`). Findings are structured into pgvector memory.
  - `ReplyIntent` (`interested|not_now|unsubscribe|question|other`) — outreach
    copy must be written anticipating these reply intents (clear CTA, easy opt-out).
  - `AgentRunInput` / `AgentRunOutput` — the instruction file IS the agent's
    system prompt; keep it a single coherent brief the runner injects context into.
- `packages/gate/src/gates/marketing.ts`: outreach `draft→approved→sent` and
  campaign `draft→approved→published` state machines. Every instruction file must
  state plainly that the agent STOPS at a draft/proposal — it never sends,
  publishes, or spends. HITL approve is mandatory through M12.

## Deliverable (content requirements)

Each of the three instruction files must contain, clearly sectioned:

1. **Role + boundaries** — one-paragraph responsibility, then an explicit
   "You produce drafts only; a human approves before any send/publish/spend" note.
2. **On-voice guidance** — hrmny house voice (concise, senior, no filler/hype).
3. **Bilingual EN/AR** — how to produce on-voice copy in both English and Arabic
   (register, RTL/formatting notes, when to mirror vs. transcreate — not literal
   translation). Applies to `creative` and `outreach-draft`; `research` stays EN
   for internal briefs but must handle AR-language sources.
4. **Structured-output contract** — for `research` Competitor-Research mode, the
   `CompetitorFinding` field-by-field spec + one worked example. For
   `outreach-draft`, name the `ReplyIntent` values the copy should invite/handle.
5. **Campaign report narrative template** (in `creative/instructions.md`) — a
   fill-in narrative skeleton for M9 campaign report v1 (what ran, engagement
   read-back, what to do next), EN + AR headline lines. This is marketing
   narrative only; the M10 analytics weekly report is a separate agent.

`docs/specs/m9-prompt-rationale.md`: why each change was made, the EN/AR voice
decisions, and a review checklist an approver runs before merge (voice ✓, HITL
note present ✓, output shape matches frozen type ✓, no `.ts` touched ✓).

## Migration slot

None. Grok ships no migrations.

## Acceptance (must pass)

- `pnpm --filter @hrmny/ai test` — GREEN. This guards the hard rule: the AI
  package tests (incl. `agents/registry.test.ts`) still pass, proving no `.ts`
  was edited and no agent id changed.
- `git diff --name-only main...feat/m9-content` lists ONLY the four files above,
  all `.md`. Any non-`.md` path fails review.
- Each instruction file contains all five sections; `CompetitorFinding` and
  `ReplyIntent` are referenced by their exact field/enum names.
- Demo it enables: brief → on-voice EN+AR draft post (creative) awaiting portal
  approval; a competitor scan emitting `CompetitorFinding`-shaped notes.

## Out of scope (DO NOT TOUCH)

- Any `.ts`/`.tsx`/`.sql`/JSON/config — including `registry.ts`, `agent-io.ts`,
  `provider.ts`, the gate files, routers, migrations.
- Instruction files for agents you do not own (e.g. `outreach` send code, `hr`,
  `finance-assist`). Only `creative`, `outreach-draft`, `research`.
- Adding a `campaigns`/`competitor-research` agent id, router, or table (orchestrator + M8/M9 code owns those).
