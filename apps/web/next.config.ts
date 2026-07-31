import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // ponytail: Vercel handles compression; re-enable here only for direct self-hosting.
  compress: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@hrmny/ui",
    "@hrmny/db",
    "@hrmny/gate",
    "@hrmny/integrations",
    "@hrmny/ai",
  ],
};

export default nextConfig;
