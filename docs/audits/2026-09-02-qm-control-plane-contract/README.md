# QM control-plane contract audit

- Date: 2026-09-02
- Branch: `ahmadbukhari097/codex/phase-5-qm-control-plane-20260902`
- Base: `d949461bf0ab47f2f07978a6ebdd2d2e448000aa`
- Code receipt: `42ed013a91ab5129e93195f9906b6635d45cda74`

## Outcome

HRMNY now has a local, provider-neutral contract for binding a personal QM session to a separately authenticated HRMNY principal. It can record a workspace-read precheck or an external-effect proposal. It cannot read a resource, execute an effect, accept caller-supplied identity, carry raw credentials, or bypass a changed session policy.

This is **contract-ready local evidence**, not a deployed QM integration. The source pin and tests establish an enforceable boundary for later adapters; they do not establish a durable PostgreSQL implementation, Fly resource, network route, live provider connection, recovery result, user acceptance, merge, or production acceptance.

## Acceptance ledger

| State                                 | Result        | Evidence                                                           |
| ------------------------------------- | ------------- | ------------------------------------------------------------------ |
| Official-source review                | Passed        | 18 source receipts; see [SOURCE-REGISTER.md](./SOURCE-REGISTER.md) |
| Local contract code                   | Passed        | `42ed013a91ab5129e93195f9906b6635d45cda74`                         |
| Focused verification                  | Passed        | 15 tests, type check, targeted lint, formatting                    |
| Full deterministic web verification   | Passed        | 133 files, 745 tests                                               |
| Production build                      | Passed        | Next.js build, 86 static pages                                     |
| Durable repository adapter            | Not built     | Open gap                                                           |
| QM/Fly provider configuration         | Not attempted | Human/provider gate                                                |
| Deployment and destination delivery   | Not attempted | Human/provider gate                                                |
| Recovery and rollback canary          | Not attempted | Explicit approval required                                         |
| UAT, merge, and production acceptance | Not granted   | Separate human gates                                               |

## Audit files

- [SOURCE-REGISTER.md](./SOURCE-REGISTER.md)
- [DECISIONS.md](./DECISIONS.md)
- [REASONS.md](./REASONS.md)
- [TRADEOFFS.md](./TRADEOFFS.md)
- [EVIDENCE.md](./EVIDENCE.md)
- [GAPS.md](./GAPS.md)
- [FAILURES.md](./FAILURES.md)
- [RUNBOOKS.md](./RUNBOOKS.md)
- [OUTCOMES.md](./OUTCOMES.md)
