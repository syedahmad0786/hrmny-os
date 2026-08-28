type SentrySdk = typeof import("@sentry/nextjs");
type CaptureRequestErrorArgs = Parameters<SentrySdk["captureRequestError"]>;

let sentrySdk: Promise<SentrySdk> | undefined;

function loadSentry() {
  sentrySdk ??= import("@sentry/nextjs");
  return sentrySdk;
}

export async function initializeSentryServer() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  const Sentry = await loadSentry();
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

export async function captureSentryRequestError(
  ...args: CaptureRequestErrorArgs
) {
  if (!process.env.SENTRY_DSN?.trim()) return;
  const Sentry = await loadSentry();
  Sentry.captureRequestError(...args);
}
