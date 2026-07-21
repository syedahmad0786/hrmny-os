import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
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
