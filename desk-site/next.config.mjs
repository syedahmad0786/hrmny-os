import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app has its own lockfile inside the monorepo. Make the intended trace
  // boundary explicit instead of relying on Next's lockfile-root inference.
  outputFileTracingRoot: repositoryRoot,
  async redirects() {
    return [
      {
        source: "/portal/:path*",
        destination: "https://hrmny-os.vercel.app/client-preview",
        permanent: false,
      },
      {
        source: "/:path*",
        destination: "https://hrmny-os.vercel.app/:path*",
        permanent: false,
      },
    ];
  },
};
export default nextConfig;
