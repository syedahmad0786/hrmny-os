# Discovery P1 handback — 21 September 2026

Writes to the coordination `EXECUTION-STATUS.md` / `CHECK-IN.md` were blocked from this file-tools session. Root should prepend this receipt there. Writer lease returned.

HEAD `0c0f102c31dfdc9a8691a6c538ca9bd652287846`. No commit, push, deploy, migration, n8n import/activation, provider call, or test execution. Sol `httpHeaderAuth` preserved.

## P1s

1. Callback admission has no provider I/O inside the locked transaction. Interpretation continues on `sales/discovery.interpret.v1` and repair-cron continue-pending, with claim/replay/cancel fences and batch 5 / 8 calls / 12k tokens / 20s tick / 90s claim ceilings.
2. Live route fails closed without current catalog zero-price proof, exact preview-model allowlist, spend/receipt wiring, and job limits. OpenRouter pins `max_price` 0/0/0, `allow_fallbacks: false`, no paid plugins.
3. Ordinary Review/default evaluation does not inject mock. Disabled interpretation stores `unavailable` and uses deterministic evidence rules only.

## Tests NOT RUN

Root must run: provider tests, interpretation/ingest/evidence-quality, n8n workflow (httpHeaderAuth 4/4), Inngest functions/discovery, repair route, web `tsc --noEmit`.

## Remaining gaps

Live price-proof, tenant JWT/httpHeaderAuth execution, n8n activation, production/preview 0085–0087, Design §8, isolated Postgres interpret proofs, owner acceptance.
