import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Apollo queued-worker import boundary", () => {
  it("does not export the unfenced receipt runner to production callers", () => {
    const source = readFileSync(
      new URL("./apollo-search.ts", import.meta.url),
      {
        encoding: "utf8",
      },
    );
    expect(source).not.toMatch(
      /export async function runScheduledApolloPeopleSearch\s*\(/,
    );
    expect(source).toMatch(
      /async function runScheduledApolloPeopleSearch\s*\(/,
    );
    expect(source).toMatch(/process\.env\.NODE_ENV !== "test"/);
    expect(source).toMatch(/executeAuthorizedProviderDispatch/);
  });
});
