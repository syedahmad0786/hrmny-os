import type { NextConfig } from "next";
import path from "node:path";

// Keep next.config self-contained: its temporary CommonJS compilation cannot
// reliably import adjacent TypeScript modules on every supported Node runtime.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
] as const;

const nextConfig: NextConfig = {
  // Vercel handles compression. Keeping the self-hosted response bounded also
  // avoids a Node/Windows chunked-transfer stall in local browser verification.
  compress: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
  transpilePackages: [
    "@hrmny/ui",
    "@hrmny/db",
    "@hrmny/gate",
    "@hrmny/integrations",
    "@hrmny/ai",
  ],
};

const sentryBuildEnabled = Boolean(
  process.env.SENTRY_DSN?.trim() ||
    process.env.NEXT_PUBLIC_SENTRY_DSN?.trim(),
);

const sentryConfig = {
  // Observability remains inert until the DSN reference is approved. Keep the
  // SDK's supported bundler integration, but disable all build-time uploads.
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
  webpack: {
    automaticVercelMonitors: false,
    treeshake: {
      removeDebugLogging: true,
      removeTracing: true,
    },
  },
} as const;

export default async function config() {
  if (!sentryBuildEnabled) return nextConfig;
  const { withSentryConfig } = await import("@sentry/nextjs");
  return withSentryConfig(nextConfig, sentryConfig);
}
