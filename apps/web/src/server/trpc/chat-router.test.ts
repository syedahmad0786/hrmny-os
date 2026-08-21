process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { getDemoStore } from "../demo-store";
import { buildChatDefaultTools } from "./chat-router";

const CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";
const EMPLOYEE_ID = "c0000000-0000-4000-8000-000000000001";

describe("chat harness funnel_act", () => {
  beforeEach(() => {
    getDemoStore().resetM4Demo();
  });

  it("requires a client sandbox", async () => {
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const funnel = tools.find((t) => t.name === "funnel_act");
    expect(funnel).toBeTruthy();
    const result = (await funnel!.run({
      prompt: "Advance funnel",
    })) as { error?: string };
    expect(result.error).toBe("client_sandbox_required");
  });

  it("runs sandboxed funnel writes when clientId is bound", async () => {
    const tools = buildChatDefaultTools({
      employeeId: EMPLOYEE_ID,
      clientId: CLIENT_ID,
    });
    const funnel = tools.find((t) => t.name === "funnel_act");
    const result = (await funnel!.run({
      prompt: "Seed brief and portal creative for UAE retail",
    })) as {
      tools?: Array<{ tool: string; ok: boolean; data?: { portalHref?: string } }>;
    };
    expect(Array.isArray(result.tools)).toBe(true);
    const byTool = Object.fromEntries(
      (result.tools ?? []).map((r) => [r.tool, r]),
    );
    expect(byTool["tasks.create"]?.ok).toBe(true);
    expect(byTool["crm.note"]?.ok).toBe(true);
    expect(byTool["creative.sendToPortal"]?.ok).toBe(true);
    expect(byTool["creative.sendToPortal"]?.data?.portalHref).toMatch(
      /\/portal\/login\/verify\?token=/,
    );
    expect(byTool["crm.prospect"]).toBeUndefined();
  });
});
