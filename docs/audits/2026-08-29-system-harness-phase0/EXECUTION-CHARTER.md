# Development and synthetic execution charter

Charter ID: `CHARTER-HRMNY-20260829-001`
Date/scope: 2026-08-29; `client-uae-creative-01/hrmny-os`
Actor: host `Bukhari-Laptop`; `Codex /root`; branch `ahmadbukhari097/codex/phase-0-baseline-20260829`; baseline `c9b420d9ad3852ea5aef042b3ad21c0399f2f72a`; implementation commit `1d0920cb49a8142c3141288a80fb7d028fe6a96c`.

## Authorized now

- Read repository/specification/provider documentation and current non-secret status.
- Modify only the isolated feature worktree.
- Add code, tests, fixtures, documentation, harness records, and Graphify updates.
- Run deterministic local tests with mock providers and memory/local disposable state.
- Push a reviewable feature branch and open a pull request; do not merge.

## Explicitly not authorized

- Production or live-provider mutation, database migration, deployment promotion, credential rotation, account/resource creation, billing acceptance, paid enrichment, message send, publication, client-visible change, destructive cleanup, or UAT impersonation.
- Reading or copying secret values into code, logs, receipts, screenshots, agent prompts, or documentation.
- Any operation against ChiroCandy credentials, IDs, data, domains, or environments.

## Effect and cost ceiling

- Data: synthetic only.
- Provider modes: mock; outbound network denied in ordinary tests.
- External messages/publications: zero.
- Provider/database/account writes: zero.
- Spend: USD/AED 0.
- Production ref `klrugedztqxlvyghyzxs`: hard-denied for synthetic live proof.

## Rollback, expiry, and receipt

- Rollback: revert the feature commit or close the unmerged pull request.
- Local dependency/cache artifacts are ignored and disposable.
- This charter expires when this branch is merged/closed or when scope changes.
- Authorization receipt: the owner mission dated 2026-08-29 authorizing autonomous normal code/browser/CLI/test/setup work while reserving the enumerated human checkpoints.
- Correction path: append a superseding charter; never broaden this charter silently.
