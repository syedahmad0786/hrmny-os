import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import AssetsProbePage from "./assets/page";
import GatePage from "./gate/page";

const probes = [AssetsProbePage, GatePage];

describe("development-only route runtime boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders both probes in local development", () => {
    vi.stubGlobal("React", React);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("AUTH_MODE", "dev");
    for (const render of probes) expect(render()).toBeTruthy();
  });

  it.each(["preview", "production"])(
    "returns not found for both probes in Vercel %s",
    (environment) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("VERCEL_ENV", environment);
      vi.stubEnv("AUTH_MODE", "dev");
      vi.stubEnv("ALLOW_DEV_AUTH", "true");
      for (const render of probes) expect(() => render()).toThrow();
    },
  );
});
