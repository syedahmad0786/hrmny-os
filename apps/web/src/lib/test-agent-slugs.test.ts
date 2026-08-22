import { describe, expect, it } from "vitest";
import { isPrunableTestAgentSlug } from "./test-agent-slugs";

describe("isPrunableTestAgentSlug", () => {
  it("targets proof/e2e artifacts but keeps seeded coaches", () => {
    expect(isPrunableTestAgentSlug("proof-agent-123")).toBe(true);
    expect(isPrunableTestAgentSlug("e2e-cmd-123")).toBe(true);
    expect(isPrunableTestAgentSlug("e2e-os-123")).toBe(true);
    expect(isPrunableTestAgentSlug("delivery-coach")).toBe(false);
    expect(isPrunableTestAgentSlug("os-settle")).toBe(false);
    expect(isPrunableTestAgentSlug("brand-voice")).toBe(false);
  });
});
