import { describe, expect, it } from "vitest";
import { isHardApiKeyRejection } from "./api-key-rejection";

describe("isHardApiKeyRejection", () => {
  it("flags auth failures", () => {
    expect(isHardApiKeyRejection("Company search failed: HTTP 401")).toBe(true);
    expect(isHardApiKeyRejection("API key is invalid")).toBe(true);
    expect(isHardApiKeyRejection("API key too short")).toBe(true);
  });

  it("does not flag transport flakes", () => {
    expect(isHardApiKeyRejection("fetch failed")).toBe(false);
    expect(isHardApiKeyRejection("ETIMEDOUT")).toBe(false);
    expect(isHardApiKeyRejection("429 rate limited")).toBe(false);
  });
});
