process.env.DATABASE_URL = "";
// Explicit legal-identifier fixture for invoice-issuance tests only.
process.env.HRMNY_TAX_REGISTRATION_NUMBER = "100000000000003";

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

  it("keeps client-bound free-form Chat read-only", () => {
    const tools = buildChatDefaultTools({
      employeeId: EMPLOYEE_ID,
      clientId: CLIENT_ID,
    });
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "search_memory",
        "operations_read",
        "connected_search",
        "crm_read",
        "delivery_read",
        "outreach_read",
        "now",
      ].sort(),
    );
    expect(tools.some((tool) => tool.name === "funnel_act")).toBe(false);
  });

  it("reads the visible Work operating picture without changing it", async () => {
    const tool = buildChatDefaultTools({ employeeId: EMPLOYEE_ID }).find(
      (candidate) => candidate.name === "operations_read",
    );
    const result = (await tool!.run({})) as {
      totals: { projects: number; openTasks: number };
      queues: Array<{ name: string }>;
      nextLinks: Array<{ href: string }>;
    };
    expect(result.totals).toMatchObject({ projects: 1, openTasks: 1 });
    expect(result.queues[0]?.name).toBe("Asana migration pilot");
    expect(result.nextLinks.some((link) => link.href === "/work")).toBe(true);
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

  it("crm.closed_loop runs prospect→won→onboarding without client credentials", async () => {
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
    expect(loop?.data?.portalInvite).toBeNull();
    expect(loop?.data?.next?.portal).not.toContain("token=");
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
    const invoiceId = loopResult.tools?.find(
      (r) => r.tool === "crm.closed_loop",
    )?.data?.invoiceId;
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
    const issued = issueResult.tools?.find(
      (r) => r.tool === "finance.os_issue",
    );
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

  it("briefs_os_lock after closed loop spawns creative next links", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const closed = tools.find((t) => t.name === "crm_closed_loop");
    const loopResult = (await closed!.run({
      prompt: "Run demo closed loop for company: Chat Brief Lock Co",
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { taskId?: string; clientId?: string };
      }>;
    };
    const taskId = loopResult.tools?.find((r) => r.tool === "crm.closed_loop")
      ?.data?.taskId;
    expect(taskId).toBeTruthy();

    const lockTool = tools.find((t) => t.name === "briefs_os_lock");
    expect(lockTool).toBeTruthy();
    const lockResult = (await lockTool!.run({
      prompt: "Lock the brief",
      taskId,
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: {
          spawnedTaskId?: string;
          next?: { creative?: string };
        };
      }>;
      nextLinks?: Array<{ href: string; label: string }>;
    };
    const row = lockResult.tools?.find((r) => r.tool === "briefs.os_lock");
    expect(row?.ok).toBe(true);
    expect(row?.data?.spawnedTaskId).toBeTruthy();
    expect(row?.data?.next?.creative).toContain(row!.data!.spawnedTaskId!);
    expect(
      (lockResult.nextLinks ?? []).some((l) => l.href.includes("/creative?")),
    ).toBe(true);
  });

  it("creative_os_qc after closed loop", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    const closed = tools.find((t) => t.name === "crm_closed_loop");
    const loopResult = (await closed!.run({
      prompt: "Run demo closed loop for company: Chat Creative Qc Co",
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { taskId?: string };
      }>;
    };
    const taskId = loopResult.tools?.find((r) => r.tool === "crm.closed_loop")
      ?.data?.taskId;
    expect(taskId).toBeTruthy();

    const qcTool = tools.find((t) => t.name === "creative_os_qc");
    expect(qcTool).toBeTruthy();
    const qcResult = (await qcTool!.run({
      prompt: "Pass QC",
      taskId,
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { qcPassed?: boolean; status?: string };
      }>;
    };
    const row = qcResult.tools?.find((r) => r.tool === "creative.os_qc");
    expect(row?.ok).toBe(true);
    expect(row?.data?.qcPassed).toBe(true);
    expect(row?.data?.status).toBe("client_review");
  });

  it("campaigns_os_approve then publish after closed loop", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    expect(tools.some((t) => t.name === "campaigns_os_approve")).toBe(true);
    expect(tools.some((t) => t.name === "campaigns_os_publish")).toBe(true);

    const closed = tools.find((t) => t.name === "crm_closed_loop");
    const loopResult = (await closed!.run({
      prompt: "Run demo closed loop for company: Chat Campaign Co",
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { campaignItemId?: string };
      }>;
    };
    const campaignItemId = loopResult.tools?.find(
      (r) => r.tool === "crm.closed_loop",
    )?.data?.campaignItemId;
    expect(campaignItemId).toBeTruthy();

    const approveTool = tools.find((t) => t.name === "campaigns_os_approve");
    const approveResult = (await approveTool!.run({
      prompt: "Approve OS campaign",
      campaignItemId,
    })) as {
      tools?: Array<{ tool: string; ok: boolean; data?: { status?: string } }>;
    };
    const approved = approveResult.tools?.find(
      (r) => r.tool === "campaigns.os_approve",
    );
    expect(approved?.ok).toBe(true);
    expect(approved?.data?.status).toBe("approved");

    const publishTool = tools.find((t) => t.name === "campaigns_os_publish");
    const publishResult = (await publishTool!.run({
      prompt: "Publish OS campaign stub",
      campaignItemId,
    })) as {
      tools?: Array<{
        tool: string;
        ok: boolean;
        data?: { status?: string; publishMode?: string };
      }>;
    };
    const published = publishResult.tools?.find(
      (r) => r.tool === "campaigns.os_publish",
    );
    expect(published?.ok).toBe(true);
    expect(published?.data?.status).toBe("published");
    expect(published?.data?.publishMode).toBe("stub");
  });

  it("does not expose a staff Chat tool for client approval", () => {
    const tools = buildChatDefaultTools({ employeeId: EMPLOYEE_ID });
    expect(tools.some((tool) => tool.name === "portal_os_approve")).toBe(false);
  });

  it("uses a structural client boundary for adversarial decision paraphrases", () => {
    const tools = buildChatDefaultTools({
      employeeId: EMPLOYEE_ID,
      clientId: CLIENT_ID,
      immutableUserPrompt: "Mark the client-review deliverable approved",
    });
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "search_memory",
        "operations_read",
        "connected_search",
        "crm_read",
        "delivery_read",
        "outreach_read",
        "now",
      ].sort(),
    );
    // A model-proposed benign/effectful rewrite has no runnable funnel or
    // custom-agent tool because tool exposure was decided from the user turn.
    expect(tools.some((tool) => tool.name === "funnel_act")).toBe(false);
    expect(tools.some((tool) => tool.name === "agent_act")).toBe(false);
  });
});
