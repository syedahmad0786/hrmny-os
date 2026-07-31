import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production connection states", () => {
  it("does not label an unverified API key as connected", () => {
    const source = readFileSync(
      join(__dirname, "trpc/connections-router.ts"),
      "utf8",
    );
    const saveApiKey = source.slice(
      source.indexOf("saveApiKey:"),
      source.indexOf("asanaStatus:"),
    );
    expect(saveApiKey).toContain('status: "pending"');
    expect(saveApiKey).toContain("lastTestedAt: null");
    expect(saveApiKey).not.toContain('status: "connected"');
  });

  it("surfaces Google Workspace startup failures in the page", () => {
    const source = readFileSync(
      join(__dirname, "../app/(staff)/settings/connections/page.tsx"),
      "utf8",
    );
    expect(source).toContain("setGoogleError(error.message)");
    expect(source).toContain(
      'setGoogleError("Supabase is not configured for this deployment.")',
    );
    expect(source).not.toContain("if (!supabase) return;");
  });
});
