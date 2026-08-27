import { describe, expect, it } from "vitest";
import {
  formatReadyDbLine,
  formatReadyLlmLine,
  formatReadyToolsLine,
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
      "database up · key store vault · pgvector on · portal magic-link enabled",
    );
  });

  it("formatReadyToolsLine summarizes integration tool modes", () => {
    const ready: ReadySmoke = {
      tools: {
        n8n: "configured",
        apollo: "mock",
        openrouter: "configured",
      },
    };
    expect(formatReadyToolsLine(ready)).toContain("n8n configured");
    expect(formatReadyToolsLine(ready)).toContain("apollo mock");
  });
});
