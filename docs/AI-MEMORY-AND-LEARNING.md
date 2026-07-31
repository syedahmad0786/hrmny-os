# AI memory, retrieval, and model improvement

This document describes how hrmny OS improves agent quality **without** shipping a custom fine-tuned model in v1.

## Architecture

1. **CRM / Work tables remain system of truth** (deals, notes, tasks, clients).
2. **`memory_chunk` (pgvector, 1536 dims)** stores semantic copies for retrieval:
   - CRM notes (`source_type=note`)
   - Win/loss notes (`source_type=feedback` + `win_loss_notes` table)
   - Future: emails, docs, HITL edits
3. **Agents retrieve-before-act** via `boundRunAgent` (`apps/web/src/server/ai/run-agent-bound.ts`):
   - `recallMemory(query, dealId?)` → inject `context.memory`
   - Metered LLM call (`LLM_PROVIDER` / OpenRouter / Anthropic / mock)
   - Persist `agent_runs` for cost + eval traces
4. **Embeddings** use `OPENAI_API_KEY` + `text-embedding-3-small`. If the key is missing, chunks still persist and retrieval falls back to keyword search.

## How this helps “refine the model”

| Loop | What happens | Effect |
|------|----------------|--------|
| Note capture | Staff writes CRM note → `rememberChunk` | Future drafts see account nuance |
| Win/loss | Deal close → `recordWinLossNote` + embed | Similar pitches retrieve past outcomes |
| HITL edits | Approved/edited outreach stored as feedback (next slice) | Prompt context mirrors what humans ship |
| Evals | `packages/ai` eval harness + nightly job | Measure before raising autonomy |
| Cost | `agent_runs` + `LLM_MONTHLY_CAP_AED` | Fail closed on spend runaway |

This is **RAG + preference memory**, not weight training.

## Fine-tuning (later, optional)

Do **not** fine-tune until:

1. ≥4 weeks of labeled HITL outcomes (approve / edit / reject) with stable schemas
2. Eval harness shows a clear lift from RAG alone has plateaued
3. Export job produces `(system, user, approved_completion)` pairs from `agent_runs` + feedback chunks
4. A separate LoRA / SFT experiment beats the RAG baseline on held-out evals

Until then, improve quality by:

- Writing better win/loss notes
- Connecting live `OPENAI_API_KEY` + `OPENROUTER_API_KEY`
- Growing `memory_chunk` coverage (emails, competitor findings)
- Creating an IVFFlat/HNSW index after ~100+ embedded rows (`0003_pgvector_memory.sql` comment)

## Ops checklist

| Env | Purpose |
|-----|---------|
| `DATABASE_URL` | Required when `AUTH_MODE=supabase` |
| `OPENAI_API_KEY` | Embeddings for pgvector |
| `OPENROUTER_API_KEY` / `LLM_PROVIDER` | Live generation |
| `LLM_MONTHLY_CAP_AED` | Hard monthly breaker (default 1500) |
| `ALLOW_MEMORY_STORE=true` | Local development only; hosted preview/production still fail closed |
