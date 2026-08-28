type SentrySdk = typeof import("@sentry/nextjs");
type RouterTransitionArgs = Parameters<
  SentrySdk["captureRouterTransitionStart"]
>;

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
let sentrySdk: Promise<SentrySdk> | undefined;

function loadSentry() {
  sentrySdk ??= import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
    return Sentry;
  });
  return sentrySdk;
}

if (dsn) void loadSentry();

export function onRouterTransitionStart(...args: RouterTransitionArgs) {
  if (!dsn) return;
  void loadSentry().then((Sentry) =>
    Sentry.captureRouterTransitionStart(...args),
  );
}
