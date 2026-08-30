import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => readFileSync(`${repoRoot}/${path}`, "utf8");

describe("repository runtime contract", () => {
  it("pins Node 24 for local and every executable workflow", () => {
    expect(JSON.parse(read("package.json")).engines.node).toBe("24.x");
    expect(read(".nvmrc").trim()).toBe("24");

    for (const workflow of [
      ".github/workflows/ci.yml",
      ".github/workflows/nightly-eval.yml",
      ".github/workflows/demo-os-live-proof.yml",
      ".github/workflows/openrouter-live-smoke.yml",
      ".github/workflows/production-migrate.yml",
    ]) {
      const source = read(workflow);
      expect(source, workflow).toMatch(/node-version:\s*24/);
      expect(source, workflow).not.toMatch(/node-version:\s*22/);
    }
  });
});
