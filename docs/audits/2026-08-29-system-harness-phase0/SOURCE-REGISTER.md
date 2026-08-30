# Source register

Register ID: `SRCREG-HRMNY-20260829-001`
Date/scope: 2026-08-29; `client-uae-creative-01/hrmny-os`
Actor: host `Bukhari-Laptop`; `Codex /root`; branch `ahmadbukhari097/codex/phase-0-baseline-20260829`; baseline `c9b420d9ad3852ea5aef042b3ad21c0399f2f72a`.

The location column identifies an authority class without committing workstation-specific paths or client documents.

## Product sources

| Rank | Source                                 | Location                              | SHA-256 / revision                                                 | Use                             | Status                               |
| ---: | -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------------------- | ------------------------------------ |
|    1 | `syedahmad0786/hrmny-os` `origin/main` | canonical GitHub repository           | `c9b420d9ad3852ea5aef042b3ad21c0399f2f72a`                         | as-built truth                  | verified current 2026-08-29          |
|    2 | `docs/PLAN-PRODUCTION.md`              | canonical repository                  | `F3FCEDFAB7BA6338AF6409EA00E6CCEFD879387A466EDC90627BE98C448E71A2` | governing intent                | verified                             |
|    3 | `docs/SALES-GROWTH-CUTOVER.md`         | canonical repository                  | `FC9F6C4693758D18B3B22AF6D4D1A9CA2B5006CCB6D6A3B985F191680957A712` | accepted Sales contract         | verified                             |
|    4 | completion `OUTCOMES.md`               | canonical repository                  | `161E5994B79D2B8AD4EA347B4529180CEB3DCB2D85E2FB46E055AB2D73F66FB5` | latest retained receipts        | verified, freshness varies           |
|    4 | `M1-COMPLETION-AUDIT.md`               | canonical repository                  | `90FE6A6AA7D9119B5C481B6C641EB3FE0D9735BF48F927CEF07274E3D1547847` | completion evidence/gaps        | verified, historical                 |
|    5 | `_CONTEXT.md`                          | read-only coordination specifications | `5787D2...C213`                                                    | business context                | hash frozen; not versioned with code |
|    5 | `L0-PRD-product-requirements.md`       | read-only coordination specifications | `08D53F...F1A3`                                                    | business requirements           | hash frozen; not versioned with code |
|    5 | `L1-SAD-system-architecture.md`        | read-only coordination specifications | `85A4B3...861E`                                                    | legacy architecture/security    | hash frozen; conflicts require ADR   |
|    5 | `L1-INTG-integration-architecture.md`  | read-only coordination specifications | `B53B76...F1BB`                                                    | legacy integration requirements | hash frozen; conflicts require ADR   |
|    5 | `L5-UXSPEC-ui-ux-spec.md`              | read-only coordination specifications | `D50E69...F95A`                                                    | role/portal UX                  | hash frozen                          |
|    5 | persona specification                  | read-only coordination specifications | `A6D792...A347`                                                    | role journeys                   | hash frozen                          |
|    5 | wireframe specification                | read-only coordination specifications | `3F9982...60C6`                                                    | journey detail                  | hash frozen                          |
|    6 | `docs/MASTER-PLAN-V2.md`               | canonical repository                  | `A166D3275AF62C7967F33B1533FC27D97EC8A2D1009ECDD2614C367140772EBB` | historical planning only        | superseded where conflicting         |

Abbreviated hashes are retained here only where the full hash was recorded in the read-only coordination receipt but the source is not copied into this repository. Before a source-changing implementation, capture the full current hash in an approved source registry update.

## External implementation sources

| Component   | Official source/pin                                                                                                                                                                                                                                                                                                                                                                                               | Verified contract                                                                                                | Status                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| QM          | `yc-software/qm`; stable `v0.1.5`, commit `d931fe963de3ac20b9a7526ea9a4873c0d8ed18e`; current reviewed head `a0dd5b08a5438cf240ec5c69080019e9bfed9a7c`                                                                                                                                                                                                                                                            | MIT; Node 24; Fly Sprites-based experimental runtime                                                             | verified source; deployment/isolation gap                   |
| GBrain      | `garrytan/gbrain`; stable `v0.47.6.0`, commit `3f2f300483bb24f97e0276f44ee3053b5d30a36b`; Linux x64 SHA-256 `44069bd8914c11df62d638c052de0140f0351f71d79131467228f9472e36805a`                                                                                                                                                                                                                                    | MIT; dedicated PostgreSQL+pgvector; source-scoped OAuth/MCP                                                      | verified source; no official production OCI/Fly contract    |
| Google Chat | [Configure](https://developers.google.com/workspace/chat/configure-chat-api), [verify requests](https://developers.google.com/workspace/chat/verify-requests-from-chat), [receive/respond](https://developers.google.com/workspace/chat/receive-respond-interactions), [auth](https://developers.google.com/workspace/chat/authenticate-authorize), [quotas](https://developers.google.com/workspace/chat/limits) | exact-audience Google-signed ID token, Chat service identity, durable async API response, `chat.bot` pilot scope | verified official docs; HRMNY Cloud/Workspace ownership gap |
| Fly.io      | official Fly/QM deployment sources reviewed in QM audit                                                                                                                                                                                                                                                                                                                                                           | organization-owned pilot; explicit cost/region/lifecycle; no assumed Machine-per-chat mapping                    | source verified with runtime gaps                           |
| Apollo      | official People Search, People Match, Organization Search, and rate-limit docs                                                                                                                                                                                                                                                                                                                                    | search discovery can be zero-credit; paid Match is candidate-bound/action-time approved                          | verified; exact cost may vary by returned data              |
| Gmail       | official send/get/history/push/sync docs                                                                                                                                                                                                                                                                                                                                                                          | send requires effect receipt, readback, reconciliation, reply cursor                                             | verified; HRMNY destination acceptance pending              |

## Source gaps

- Shared specifications are not versioned with the canonical repository.
- Referenced `90-Day-Build-Plan.md`, L7 backlog, and Lead-to-Cash source exist only in the coordination workspace.
- Current production deployment SHA and authenticated role behavior were not independently read back in this run.
- QM has experimental/multi-user limitations and no accepted HRMNY Fly topology.
- GBrain has no official production OCI/Fly image and incomplete deletion/offboarding guarantees across exports/backups.
- Google Cloud project, Chat app, Workspace admin, service account, exact production audience, and two named user subjects are unverified.
- Handling fee is contradictory (15% vs 20%); no value may be hard-coded until owner-confirmed.
- Canonical partner display spelling varies; provider subject/membership must be authoritative.

Correction path: update this register with a new stable ID, full source hash/revision, owner, authority tier, evidence link, and supersession relationship. Never silently replace an entry.
