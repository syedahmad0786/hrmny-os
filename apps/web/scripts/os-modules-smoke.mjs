/**
 * Smoke: OS modules (notifications, chat harness, image gen, custom agents).
 * Run: node apps/web/scripts/os-modules-smoke.mjs
 */
import { createProvider, generateImage, runHarness } from "../../../packages/ai/src/index.ts";

async function main() {
  const harness = await runHarness({
    system: "You are a test harness.",
    user: "What time is it? Use the now tool.",
    maxIterations: 3,
    tools: [
      {
        name: "now",
        description: "Return UTC time",
        run: async () => ({ utc: "2026-08-21T00:00:00.000Z" }),
      },
    ],
    generate: async (messages) => {
      const last = messages[messages.length - 1];
      if (last?.role === "user" && last.content.includes("Observation")) {
        return "The UTC time is 2026-08-21T00:00:00.000Z.";
      }
      return '```tool\n{"name":"now","arguments":{}}\n```';
    },
  });
  if (!harness.answer.includes("2026-08-21")) {
    throw new Error(`Harness answer unexpected: ${harness.answer}`);
  }
  if (harness.steps.length < 2) {
    throw new Error("Expected tool step + answer");
  }

  const img = await generateImage({ prompt: "smoke test ochre sand" });
  if (!img.imageUrl?.startsWith("data:image/svg")) {
    // live OpenRouter may return a remote URL — both OK
    if (!img.imageUrl && !img.imageB64) throw new Error("No image");
  }

  const provider = createProvider({ provider: "mock" });
  const gen = await provider.generate({
    messages: [{ role: "user", content: "ping" }],
    task: "generic",
  });
  if (!gen.text) throw new Error("Mock provider empty");

  console.log(
    JSON.stringify(
      {
        ok: true,
        harnessSteps: harness.steps.length,
        imageProvider: img.provider,
        llm: provider.name,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
