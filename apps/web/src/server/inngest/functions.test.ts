import { afterEach, describe, expect, it, vi } from "vitest";
import { inngestCloudConfigured } from "./client";
import { inngestFunctions } from "./functions";

describe("Inngest bridge", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers both durable schedule functions locally", () => {
    expect(inngestFunctions).toHaveLength(2);
  });

  it("does not claim provider acceptance without both exact key refs", () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "event-key");
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    expect(inngestCloudConfigured()).toBe(false);
    vi.stubEnv("INNGEST_SIGNING_KEY", "signing-key");
    expect(inngestCloudConfigured()).toBe(true);
  });
});
