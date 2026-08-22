import { describe, expect, it } from "vitest";
import {
  formatReadyDbLine,
  formatReadyLlmLine,
  type ReadySmoke,
} from "./ready-smoke";

describe("ready-smoke formatters", () => {
  it("formatReadyLlmLine includes provider, model, and free guard", () => {
    const ready: ReadySmoke = {
      llmProvider: "openrouter",
      llmDefaultModel: "stealth/ox-alpha",
      llmFreeOnly: true,
    };
    expect(formatReadyLlmLine(ready)).toBe(
      "openrouter · stealth/ox-alpha · free routes only",
    );
  });

  it("formatReadyDbLine summarizes database and portal magic-link", () => {
    const ready: ReadySmoke = {
      database: "up",
      pgvector: true,
      portalMagicLink: "enabled",
    };
    expect(formatReadyDbLine(ready)).toBe(
      "database up · pgvector on · portal magic-link enabled",
    );
  });
});
