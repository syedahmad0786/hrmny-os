import { describe, expect, it } from "vitest";
import { runHarness } from "./harness";
import { generateImage } from "./image";

describe("runHarness", () => {
  it("executes a tool then returns a final answer", async () => {
    let calls = 0;
    const result = await runHarness({
      system: "test",
      user: "use now",
      maxIterations: 3,
      tools: [
        {
          name: "now",
          description: "time",
          run: async () => ({ utc: "t0" }),
        },
      ],
      generate: async () => {
        calls += 1;
        if (calls === 1) {
          return '```tool\n{"name":"now","arguments":{}}\n```';
        }
        return "It is t0.";
      },
    });
    expect(result.steps.some((s) => s.toolName === "now")).toBe(true);
    expect(result.answer).toContain("t0");
  });
});

describe("generateImage", () => {
  it("returns a mock SVG when provider is mock", async () => {
    const prev = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "mock";
    const res = await generateImage({ prompt: "test art" });
    process.env.LLM_PROVIDER = prev;
    expect(res.provider).toBe("mock");
    expect(res.imageUrl?.startsWith("data:image/svg")).toBe(true);
  });
});
