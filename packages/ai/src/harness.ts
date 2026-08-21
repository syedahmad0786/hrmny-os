/**
 * Lightweight ReAct / DeepSeek-style harness for OpenRouter chat agents.
 * Plan → act (tools) → observe → answer. No CrewAI/LangGraph dependency —
 * optional LangSmith-style trace events via onStep callback.
 */

export type HarnessTool = {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

export type HarnessMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
};

export type HarnessStep = {
  iteration: number;
  thought?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  observation?: string;
  answer?: string;
};

export type HarnessRunInput = {
  system: string;
  user: string;
  tools?: HarnessTool[];
  maxIterations?: number;
  /** LLM call — returns assistant text */
  generate: (messages: HarnessMessage[]) => Promise<string>;
  onStep?: (step: HarnessStep) => void | Promise<void>;
};

export type HarnessRunResult = {
  answer: string;
  steps: HarnessStep[];
  messages: HarnessMessage[];
};

const TOOL_CALL_RE =
  /```tool\s*\n?\s*(\{[\s\S]*?\})\s*\n?```|TOOL_CALL:\s*(\{[\s\S]*?\})(?=\n|$)/i;

function parseToolCall(
  text: string,
): { name: string; args: Record<string, unknown> } | null {
  const m = text.match(TOOL_CALL_RE);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      name?: string;
      tool?: string;
      arguments?: Record<string, unknown>;
      args?: Record<string, unknown>;
    };
    const name = parsed.name ?? parsed.tool;
    if (!name) return null;
    return {
      name,
      args: parsed.arguments ?? parsed.args ?? {},
    };
  } catch {
    return null;
  }
}

function toolCatalog(tools: HarnessTool[]): string {
  if (!tools.length) return "No tools available. Answer directly.";
  return tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");
}

/**
 * Run a ReAct loop. When the model emits a tool call fence, execute and continue.
 * Final answer is the last assistant message without a tool call.
 */
export async function runHarness(
  input: HarnessRunInput,
): Promise<HarnessRunResult> {
  const tools = input.tools ?? [];
  const maxIterations = input.maxIterations ?? 4;
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const system = [
    input.system,
    "",
    "You are running inside a ReAct harness (plan → act → observe).",
    "Available tools:",
    toolCatalog(tools),
    "",
    "To call a tool, reply with ONLY:",
    '```tool',
    '{"name":"tool_name","arguments":{...}}',
    "```",
    "Otherwise reply with the final answer for the user (no tool fence).",
  ].join("\n");

  const messages: HarnessMessage[] = [
    { role: "system", content: system },
    { role: "user", content: input.user },
  ];
  const steps: HarnessStep[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const text = await input.generate(messages);
    messages.push({ role: "assistant", content: text });
    const call = parseToolCall(text);
    if (!call) {
      const step: HarnessStep = { iteration: i, answer: text };
      steps.push(step);
      await input.onStep?.(step);
      return { answer: text, steps, messages };
    }

    const tool = toolMap.get(call.name);
    let observation: string;
    if (!tool) {
      observation = `Unknown tool: ${call.name}`;
    } else {
      try {
        const result = await tool.run(call.args);
        observation =
          typeof result === "string" ? result : JSON.stringify(result);
      } catch (e) {
        observation = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const step: HarnessStep = {
      iteration: i,
      thought: text.slice(0, 400),
      toolName: call.name,
      toolArgs: call.args,
      observation: observation.slice(0, 4000),
    };
    steps.push(step);
    await input.onStep?.(step);

    messages.push({
      role: "tool",
      content: observation.slice(0, 8000),
      toolName: call.name,
    });
    messages.push({
      role: "user",
      content:
        "Tool result received. Continue: call another tool if needed, or give the final answer.",
    });
  }

  const fallback =
    steps[steps.length - 1]?.observation ??
    "Harness stopped after max iterations without a final answer.";
  return { answer: fallback, steps, messages };
}
