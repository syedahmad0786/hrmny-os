/**
 * Live OpenRouter smoke — free models only.
 * Usage:
 *   OPENROUTER_LIVE_SMOKE=1 OPENROUTER_API_KEY=sk-or-... \
 *   LLM_DEFAULT_MODEL=stealth/ox-alpha \
 *   pnpm exec vitest run src/provider.live.test.ts
 */
import { describe, expect, it } from "vitest";
import { createProvider, isOpenRouterFreeRoute } from "./provider";

const live =
  process.env.OPENROUTER_LIVE_SMOKE === "1" &&
  Boolean(process.env.OPENROUTER_API_KEY?.trim());

describe.runIf(live)("openrouter free live smoke", () => {
  it("stealth/ox-alpha returns assistant text", async () => {
    const model = process.env.LLM_DEFAULT_MODEL?.trim() || "stealth/ox-alpha";
    expect(isOpenRouterFreeRoute(model)).toBe(true);

    const provider = createProvider({
      provider: "openrouter",
      defaultModel: model,
      openRouterApiKey: process.env.OPENROUTER_API_KEY,
    });
    const result = await provider.generate({
      messages: [{ role: "user", content: "Reply with exactly: FREE_OK" }],
      task: "generic",
      temperature: 0,
    });
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(result.model).toBeTruthy();
    expect(isOpenRouterFreeRoute(result.model)).toBe(true);
  });

  it("refuses paid model ids", async () => {
    const provider = createProvider({
      provider: "openrouter",
      defaultModel: "openai/gpt-4o",
      openRouterApiKey: process.env.OPENROUTER_API_KEY,
    });
    await expect(
      provider.generate({
        messages: [{ role: "user", content: "hi" }],
        task: "generic",
      }),
    ).rejects.toThrow(/free allowlist/i);
  });
});
