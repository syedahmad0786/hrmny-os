# Tradeoffs

| Choice                                      | Benefit                                                                         | Cost / residual risk                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stable QM release pin                       | Reproducible reviewed source boundary                                           | Upstream fixes require an explicit re-review and pin change                       |
| Trusted principal separate from command     | Prevents caller-controlled organization/employee identity                       | Requires a server adapter to supply the authenticated principal                   |
| Read precheck instead of read authorization | Prevents the contract from implying ownership was resolved                      | A repository scope resolver must be implemented before any data can be returned   |
| Proposal-only effects                       | Preserves preview, human approval, and effect-broker gates                      | No end-to-end provider action is available yet                                    |
| Generic denial                              | Avoids scope and lifecycle enumeration                                          | Operators need a separate protected audit channel for diagnostic detail           |
| Policy-bound replay                         | Revocation and grant changes cannot reuse stale success                         | Clients must issue a new request ID after legitimate policy changes               |
| Repository interface without adapter        | Allows boundary tests without database/provider risk                            | Concurrency is not production-proven until a durable atomic implementation exists |
| No cyber-sensitive failure injection        | Preserves the user's separate hardening work and avoids the prior check trigger | Network-loss and recovery behavior remain unverified                              |
