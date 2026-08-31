import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
    exclude: [
      "src/server/demo-os-live-proof.test.ts",
      "src/server/sales-os/apollo-search-postgres.test.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
