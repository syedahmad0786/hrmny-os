/**
 * Provider activation is deliberately deferred until the SENTRY_DSN reference
 * and telemetry approval exist. The bounded adapter lives in
 * server/observability/sentry-adapter.ts and is not imported while gated.
 */
export function register() {}
