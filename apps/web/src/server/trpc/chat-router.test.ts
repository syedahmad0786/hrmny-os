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

  it("exposes crm_closed_loop only for org chat (no client sandbox)", async () => {
    const orgTools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const clientTools = buildChatDefaultTools({
      employeeId: EMPLOYEE_ID,
      clientId: CLIENT_ID,
    });
    expect(orgTools.some((t) => t.name === "crm_closed_loop")).toBe(true);
    expect(clientTools.some((t) => t.name === "crm_closed_loop")).toBe(false);
  });

  it("crm.closed_loop runs prospect→won→onboarding with portal links", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const closed = tools.find((t) => t.name === "crm_closed_loop");
    expect(closed).toBeTruthy();
    const result = (await closed!.run({
      prompt: "Run demo closed loop for company: Chat Loop Co",
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: {
          clientId?: string;
          invoiceId?: string;
          portalInvite?: { portalPath?: string } | null;
          next?: { portal?: string; client?: string; finance?: string };
          fired?: string[];
        };
      }>;
    };
    const loop = result.tools?.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.ok).toBe(true);
    expect(loop?.data?.clientId).toBeTruthy();
    expect(loop?.data?.invoiceId).toBeTruthy();
    expect(loop?.data?.next?.finance).toMatch(/invoiceId=/);
    expect(loop?.data?.portalInvite?.portalPath ?? loop?.data?.next?.portal).toMatch(
      /\/portal\//,
    );
    expect(loop?.data?.fired?.includes("staff.notify")).toBe(true);
  });

  it("exposes finance_os_approve/issue only for org chat", async () => {
    const orgTools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const clientTools = buildChatDefaultTools({
      employeeId: EMPLOYEE_ID,
      clientId: CLIENT_ID,
    });
    expect(orgTools.some((t) => t.name === "finance_os_approve")).toBe(true);
    expect(orgTools.some((t) => t.name === "finance_os_issue")).toBe(true);
    expect(clientTools.some((t) => t.name === "finance_os_approve")).toBe(
      false,
    );
    expect(clientTools.some((t) => t.name === "finance_os_issue")).toBe(false);
  });

  it("finance_os_approve then finance_os_issue after closed loop", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const closed = tools.find((t) => t.name === "crm_closed_loop");
    const loopResult = (await closed!.run({
      prompt: "Run demo closed loop for company: Chat Finance Co",
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { invoiceId?: string };
      }>;
    };
    const invoiceId = loopResult.tools?.find((r) => r.tool === "crm.closed_loop")
      ?.data?.invoiceId;
    expect(invoiceId).toBeTruthy();

    const approveTool = tools.find((t) => t.name === "finance_os_approve");
    const approveResult = (await approveTool!.run({
      prompt: "Approve OS invoice",
      invoiceId,
    })) as {
      tools?: Array<{ tool: string; ok: boolean; data?: { status?: string } }>;
    };
    const approved = approveResult.tools?.find(
      (r) => r.tool === "finance.os_approve",
    );
    expect(approved?.ok).toBe(true);
    expect(approved?.data?.status).toBe("approved");

    const issueTool = tools.find((t) => t.name === "finance_os_issue");
    const issueResult = (await issueTool!.run({
      prompt: "Issue OS invoice",
      invoiceId,
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { status?: string; xeroWrite?: boolean };
      }>;
    };
    const issued = issueResult.tools?.find((r) => r.tool === "finance.os_issue");
    expect(issued?.ok).toBe(true);
    expect(issued?.data?.status).toBe("issued");
    expect(issued?.data?.xeroWrite).toBe(false);
  });

  it("exposes outreach_os_approve only for org chat", async () => {
    const orgTools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const clientTools = buildChatDefaultTools({
      employeeId: EMPLOYEE_ID,
      clientId: CLIENT_ID,
    });
    expect(orgTools.some((t) => t.name === "outreach_os_approve")).toBe(true);
    expect(clientTools.some((t) => t.name === "outreach_os_approve")).toBe(
      false,
    );
  });

  it("outreach_os_approve after closed loop", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const closed = tools.find((t) => t.name === "crm_closed_loop");
    const loopResult = (await closed!.run({
      prompt: "Run demo closed loop for company: Chat Outreach Co",
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { outreachId?: string; next?: { approvals?: string } };
      }>;
    };
    const loop = loopResult.tools?.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.data?.outreachId).toBeTruthy();
    expect(loop?.data?.next?.approvals).toMatch(/id=/);

    const approveTool = tools.find((t) => t.name === "outreach_os_approve");
    const approveResult = (await approveTool!.run({
      prompt: "Approve OS outreach",
      outreachId: loop?.data?.outreachId,
    })) as {
      tools?: Array<{ tool: string; ok: boolean; data?: { state?: string } }>;
    };
    const approved = approveResult.tools?.find(
      (r) => r.tool === "outreach.os_approve",
    );
    expect(approved?.ok).toBe(true);
    expect(approved?.data?.state).toBe("approved");
  });
});
