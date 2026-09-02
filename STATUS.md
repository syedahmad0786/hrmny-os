# 2026-09-02

- Continued the interrupted build past the skipped cyber-sensitive Phase 4G worktree and preserved all of its user-owned package/patch changes untouched.
- Added the server-only QM PostgreSQL repository at `56b20af` plus nullable-JSON hardening at `ba4557b`: two tables, atomic replay, current-policy locking, strict stored-row parsing, append-only receipts, and no memory fallback or effect executor.
- Passed 19 focused QM tests, all 751 web tests, all 41 database tests, both type checks, targeted lint, and a production build with 86 static pages; hosted disposable PostgreSQL proof remains pending.
- Route activation still requires a trusted HRMNY organization source, verified auth provenance, and a default-denied `qm:use` permission; exact-preview approval, provider, recovery, UAT, merge, and production acceptance remain separate gates.
