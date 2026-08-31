import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/server/sales-os/sales-research.postgres-proof.ts"],
    setupFiles: ["./src/test/postgres-ci-setup.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
