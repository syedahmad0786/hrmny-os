# QM durable repository audit

- Date: 2026-09-02
- Branch: `ahmadbukhari097/codex/phase-5b-qm-durable-repository-20260902`
- Base: `7900ec69746438750e4bc919e862599fa3591ab7`
- Code receipts: `56b20af`, `ba4557b`

## Outcome

HRMNY now has a server-only PostgreSQL implementation of the Phase 5 QM control-plane contract. One table holds the current personal session binding; one append-only table atomically holds the authorization/idempotency receipt and its sanitized proposal or read-precheck artifact.

An allowed decision is committed only while the matching session row is locked and still has the same owner, organization, scope, lifecycle, capability, state version, source pin, runtime, provider readback, and policy digest. Concurrent identical requests resolve to one durable receipt. Browser Data API roles have no table access, malformed stored rows fail strict parsing, and the repository has no in-memory fallback.

This is **durable-adapter code with local deterministic and hosted disposable-database evidence**. PR [#248](https://github.com/syedahmad0786/hrmny-os/pull/248) is open, mergeable, and unmerged. No protected route, provider connection, approval action, effect outbox, connected QM deployment, recovery exercise, merge, UAT, or production acceptance is included.

## Acceptance ledger

| State                                      | Result         | Evidence                                      |
| ------------------------------------------ | -------------- | --------------------------------------------- |
| Source and control-plane contract          | Passed earlier | Phase 5 audit and PR 247                      |
| Additive migration and Drizzle schema      | Passed locally | Migration contract and database package tests |
| Strict row codecs and staff adapter        | Passed locally | 19 focused tests                              |
| Full deterministic web regression          | Passed locally | 134 files, 751 tests                          |
| Full deterministic database regression     | Passed locally | 7 files, 41 tests                             |
| Type checks and targeted lint              | Passed locally | Web and database packages                     |
| Production build                           | Passed locally | Next.js build, 86 static pages                |
| Disposable PostgreSQL runtime proof        | Passed twice   | PR 248 database jobs; no local database drop  |
| Hosted verify and end-to-end checks        | Passed twice   | PR 248 CI receipts                            |
| Automated security review                  | Passed         | PR 248 Cursor security receipt                |
| Automated web previews                     | Passed         | Build only; no QM route or connected runtime  |
| Trusted organization and `qm:use` route    | Not activated  | Human design/configuration gate               |
| Exact preview binding and approval handoff | Not built      | Proposal remains non-actionable               |
| Provider/deployment/recovery/UAT           | Not attempted  | Separate gates                                |
| Merge and production acceptance            | Not granted    | Human gates                                   |

## Files

- [EVIDENCE.md](./EVIDENCE.md)
- [GAPS.md](./GAPS.md)
- [RUNBOOKS.md](./RUNBOOKS.md)
