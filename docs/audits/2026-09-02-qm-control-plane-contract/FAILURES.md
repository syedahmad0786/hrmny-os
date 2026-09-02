# Failures and corrections

## Interrupted predecessor task

The predecessor task ended with a system/cyber check while work was near a PostgreSQL socket-hardening experiment. Recovery showed that the Sales Growth proposal work itself had already been completed and superseded by later green phases. The hardening experiment was not needed to complete this safe slice and remains untouched.

## Contract review findings corrected before commit

1. Caller-controlled organization and employee fields were removed from command envelopes and replaced by a separately supplied trusted principal.
2. Replay was moved behind current authorization and bound to session state and a deterministic policy digest.
3. Denials were made generic and stripped of stored personal-scope and session metadata.
4. Read results were renamed from authorization to precheck and now require later repository ownership resolution.
5. Schemas were made strict so arbitrary payload, credential, identity, session, and runtime fields fail validation rather than being stripped.
6. Receipts now bind capability, session state, policy digest, upstream commit, runtime kind, and provider readback.
7. The absence of a durable repository implementation is recorded as an open gap rather than presented as production concurrency proof.

## Non-blocking verification warning

The production build reported that the Next.js plugin is not detected by the repository's ESLint configuration. This pre-existing configuration warning did not fail linting, type checking, compilation, static page generation, or the build.
