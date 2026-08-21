import { beforeEach, describe, expect, it } from "vitest";
import { runAgentTools } from "./agent-tools";
import { getDemoStore } from "../demo-store";

/** Matches demo-store seed client used by M4 fixtures. */
const CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";

describe("runAgentTools funnel writes", () => {
  beforeEach(() => {
    getDemoStore().resetM4Demo();
  });

  it("creates campaign draft and brief inside client sandbox", async () => {
    const results = await runAgentTools({
      allowedTools: [
        "tasks.create",
        "campaigns.draft",
        "briefs.draft",
        "crm.note",
        "portal.invite",
        "creative.sendToPortal",
      ],
      prompt: "Prepare LinkedIn launch cutdowns for UAE retail",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });

    const byTool = Object.fromEntries(results.map((r) => [r.tool, r]));
    expect(byTool["tasks.create"]?.ok).toBe(true);
    expect(byTool["campaigns.draft"]?.ok).toBe(true);
    expect(byTool["briefs.draft"]?.ok).toBe(true);
    expect(byTool["crm.note"]?.ok).toBe(true);
    expect(byTool["portal.invite"]?.ok).toBe(true);
    expect(byTool["creative.sendToPortal"]?.ok).toBe(true);
    expect(byTool["crm.prospect"]).toBeUndefined();

    const campaign = byTool["campaigns.draft"]?.data as {
      status?: string;
      channel?: string;
    };
    expect(campaign?.status).toBe("draft");
    expect(campaign?.channel).toBe("linkedin");

    const brief = byTool["briefs.draft"]?.data as {
      briefId?: string;
      dorComplete?: boolean;
    };
    expect(brief?.briefId).toBeTruthy();
    expect(brief?.dorComplete).toBe(true);

    const invite = byTool["portal.invite"]?.data as {
      portalPath?: string;
      deliveryMode?: string;
    };
    expect(invite?.portalPath).toMatch(/\/portal\/login\/verify/);
    expect(invite?.portalPath).toContain(
      encodeURIComponent("/portal/approvals"),
    );
    expect(invite?.deliveryMode).toBe("mock");

    const portalAsset = byTool["creative.sendToPortal"]?.data as {
      assetId?: string;
      taskId?: string;
      portalHref?: string;
      mode?: string;
    };
    expect(portalAsset?.assetId).toBeTruthy();
    expect(portalAsset?.taskId).toBeTruthy();
    expect(portalAsset?.portalHref).toMatch(/\/portal\/login\/verify\?token=/);
    if (portalAsset?.mode === "memory") {
      const store = getDemoStore();
      expect(store.assets.has(portalAsset.assetId!)).toBe(true);
      expect(store.portalApprovals.has(portalAsset.taskId!)).toBe(true);
      const task = store.tasks.get(portalAsset.taskId!);
      expect(task?.status).toBe("client_review");
      expect(store.assets.get(portalAsset.assetId!)?.taskId).toBe(
        portalAsset.taskId,
      );
    }
  });

  it("crm.closed_loop runs prospect→won→onboarding when prompt-gated (org only)", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const results = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run demo closed loop for company: Agent Loop Co",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const loop = results.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.ok).toBe(true);
    const data = loop?.data as {
      clientId?: string;
      dealId?: string;
      viaApollo?: boolean;
      onboardingPhases?: number;
      next?: Record<string, string>;
      portalInvite?: { portalPath?: string; onboardingPath?: string } | null;
      fired?: string[];
    };
    expect(data?.clientId).toBeTruthy();
    expect(data?.dealId).toBeTruthy();
    expect(data?.viaApollo).toBe(false);
    expect((data?.onboardingPhases ?? 0) > 0).toBe(true);
    expect(data?.next?.crmDeal).toMatch(/^\/crm\/deals\//);
    expect(data?.portalInvite?.portalPath ?? "").toMatch(
      /\/portal\/login\/verify/,
    );
    expect(data?.fired?.some((f) => f === "staff.notify")).toBe(true);
  });

  it("crm.closed_loop viaApollo uses mock Apollo when keys absent", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const results = await runAgentTools({
      allowedTools: ["crm.runDemoClosedLoop"],
      prompt: "Run closed loop via Apollo",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const loop = results.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.ok).toBe(true);
    const data = loop?.data as {
      viaApollo?: boolean;
      apolloMode?: string;
    };
    expect(data?.viaApollo).toBe(true);
    expect(data?.apolloMode).toBe("mock");
  });

  it("crm.closed_loop does not fire without prompt gate even if allowlisted", async () => {
    const results = await runAgentTools({
      allowedTools: ["crm.closed_loop", "crm.read"],
      prompt: "Summarize open deals",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(results.find((r) => r.tool === "crm.closed_loop")).toBeUndefined();
  });

  it("client sandbox never runs crm.closed_loop", async () => {
    const results = await runAgentTools({
      allowedTools: ["crm.closed_loop", "crm.read"],
      prompt: "Run demo closed loop",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(results.find((r) => r.tool === "crm.closed_loop")).toBeUndefined();
  });

  it("default funnel allowlist does not include closed_loop", async () => {
    const results = await runAgentTools({
      allowedTools: [],
      prompt: "Run demo closed loop",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(results.find((r) => r.tool === "crm.closed_loop")).toBeUndefined();
  });

  it("crm.prospect imports mock Apollo companies outside client sandbox", async () => {
    const results = await runAgentTools({
      allowedTools: ["crm.prospect"],
      prompt: "UAE hospitality brands",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const prospect = results.find((r) => r.tool === "crm.prospect");
    expect(prospect?.ok).toBe(true);
    const data = prospect?.data as {
      mode?: string;
      dealCount?: number;
    };
    expect(data?.mode).toBe("mock");
    expect((data?.dealCount ?? 0) > 0).toBe(true);
  });

  it("client sandbox does not run org-wide crm.prospect", async () => {
    const results = await runAgentTools({
      allowedTools: ["crm.prospect", "crm.read"],
      prompt: "Import competitors",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(results.find((r) => r.tool === "crm.prospect")).toBeUndefined();
    const crm = results.find((r) => r.tool === "crm.read" || r.tool === "crm.deals");
    if (crm) expect(crm.ok).toBe(true);
  });

  it("falls back to funnel tools when allowlist is empty", async () => {
    const results = await runAgentTools({
      allowedTools: [],
      prompt: "Create a note about sandbox fallback",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(results.some((r) => r.tool === "crm.note" && r.ok)).toBe(true);
    expect(results.find((r) => r.tool === "crm.prospect")).toBeUndefined();
  });

  it("delivery.read stays inside the bound client sandbox", async () => {
    getDemoStore().resetM6Demo();
    const { DEMO_CLIENT_ID, DEMO_CLIENT_B_ID } = await import("../demo-store");
    const a = await runAgentTools({
      allowedTools: ["delivery.read"],
      prompt: "List delivery tasks",
      scope: {
        clientId: DEMO_CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const b = await runAgentTools({
      allowedTools: ["delivery.read"],
      prompt: "List delivery tasks",
      scope: {
        clientId: DEMO_CLIENT_B_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });

    const aData = a.find((r) => r.tool === "delivery.read")?.data as {
      tasks?: Array<{ title?: string }>;
    };
    const bData = b.find((r) => r.tool === "delivery.read")?.data as {
      tasks?: Array<{ title?: string }>;
    };
    const aBlob = JSON.stringify(aData ?? {});
    const bBlob = JSON.stringify(bData ?? {});

    expect(a.find((r) => r.tool === "delivery.read")?.ok).toBe(true);
    expect(b.find((r) => r.tool === "delivery.read")?.ok).toBe(true);
    expect(aBlob).toMatch(/Launch reel/i);
    expect(aBlob).not.toMatch(/Other Co/i);
    expect(bBlob).toMatch(/Other Co/i);
    expect(bBlob).not.toMatch(/Launch reel/i);
  });

  it("crm.read and outreach.read isolate Demo Co vs Other Co sandboxes", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    const {
      resetLeadgenStore,
      seedClientSandboxOutreach,
    } = await import("../leadgen/store");
    const {
      DEMO_CLIENT_ID,
      DEMO_CLIENT_B_ID,
      DEMO_DEAL_ID,
      DEMO_CLIENT_B_DEAL_ID,
    } = await import("../demo-store");

    resetCrmMemory();
    resetLeadgenStore();
    getDemoStore().resetM6Demo();
    seedClientSandboxOutreach({
      dealIdA: DEMO_DEAL_ID,
      dealIdB: DEMO_CLIENT_B_DEAL_ID,
    });

    const a = await runAgentTools({
      allowedTools: ["crm.read", "outreach.read"],
      prompt: "Summarize CRM and outreach",
      scope: {
        clientId: DEMO_CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const b = await runAgentTools({
      allowedTools: ["crm.read", "outreach.read"],
      prompt: "Summarize CRM and outreach",
      scope: {
        clientId: DEMO_CLIENT_B_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });

    const aCrm = a.find((r) => r.tool === "crm.read");
    const bCrm = b.find((r) => r.tool === "crm.read");
    const aOut = a.find((r) => r.tool === "outreach.read");
    const bOut = b.find((r) => r.tool === "outreach.read");
    const aCrmBlob = JSON.stringify(aCrm?.data ?? {});
    const bCrmBlob = JSON.stringify(bCrm?.data ?? {});
    const aOutBlob = JSON.stringify(aOut?.data ?? {});
    const bOutBlob = JSON.stringify(bOut?.data ?? {});

    expect(aCrm?.ok).toBe(true);
    expect(bCrm?.ok).toBe(true);
    expect(aOut?.ok).toBe(true);
    expect(bOut?.ok).toBe(true);

    expect(aCrmBlob).toMatch(/JW Marriott/i);
    expect(aCrmBlob).not.toMatch(/Other Co/i);
    expect(bCrmBlob).toMatch(/Other Co/i);
    expect(bCrmBlob).not.toMatch(/JW Marriott/i);

    expect(aOutBlob).toMatch(/Demo Co launch reel/i);
    expect(aOutBlob).not.toMatch(/Other Co confidential/i);
    expect(bOutBlob).toMatch(/Other Co confidential/i);
    expect(bOutBlob).not.toMatch(/Demo Co launch reel/i);
  });

  it("funnel writes stay inside Demo Co vs Other Co sandboxes", async () => {
    const { DEMO_CLIENT_ID, DEMO_CLIENT_B_ID } = await import("../demo-store");
    const { listCampaigns } = await import("../campaigns/repository");
    getDemoStore().resetM6Demo();

    const writes = [
      "tasks.create",
      "campaigns.draft",
      "crm.note",
      "portal.invite",
      "creative.sendToPortal",
    ] as const;

    const a = await runAgentTools({
      allowedTools: [...writes],
      prompt: "Demo Co LinkedIn launch cutdowns for UAE retail",
      scope: {
        clientId: DEMO_CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const b = await runAgentTools({
      allowedTools: [...writes],
      prompt: "Other Co confidential LinkedIn cutdowns — keep private",
      scope: {
        clientId: DEMO_CLIENT_B_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });

    for (const tool of writes) {
      expect(a.find((r) => r.tool === tool)?.ok).toBe(true);
      expect(b.find((r) => r.tool === tool)?.ok).toBe(true);
    }

    const aBlob = JSON.stringify(a);
    const bBlob = JSON.stringify(b);
    expect(aBlob).toContain(DEMO_CLIENT_ID);
    expect(aBlob).not.toContain(DEMO_CLIENT_B_ID);
    expect(aBlob).not.toMatch(/Other Co/i);
    expect(bBlob).toContain(DEMO_CLIENT_B_ID);
    expect(bBlob).not.toContain(DEMO_CLIENT_ID);
    expect(bBlob).toMatch(/Other Co/i);
    expect(bBlob).not.toMatch(/Demo Co LinkedIn launch/i);

    const aTask = a.find((r) => r.tool === "tasks.create")?.data as {
      taskId?: string;
      clientId?: string;
    };
    const bTask = b.find((r) => r.tool === "tasks.create")?.data as {
      taskId?: string;
      clientId?: string;
    };
    expect(aTask?.clientId).toBe(DEMO_CLIENT_ID);
    expect(bTask?.clientId).toBe(DEMO_CLIENT_B_ID);

    const store = getDemoStore();
    expect(store.tasks.get(aTask!.taskId!)?.clientId).toBe(DEMO_CLIENT_ID);
    expect(store.tasks.get(bTask!.taskId!)?.clientId).toBe(DEMO_CLIENT_B_ID);

    const aCampaigns = await listCampaigns({ clientId: DEMO_CLIENT_ID });
    const bCampaigns = await listCampaigns({ clientId: DEMO_CLIENT_B_ID });
    expect(
      aCampaigns.some((c) => /Demo Co LinkedIn launch/i.test(c.title)),
    ).toBe(true);
    expect(aCampaigns.every((c) => c.clientId === DEMO_CLIENT_ID)).toBe(true);
    expect(
      aCampaigns.some((c) => /Other Co confidential/i.test(c.title)),
    ).toBe(false);
    expect(
      bCampaigns.some((c) => /Other Co confidential/i.test(c.title)),
    ).toBe(true);
    expect(bCampaigns.every((c) => c.clientId === DEMO_CLIENT_B_ID)).toBe(true);
    expect(
      bCampaigns.some((c) => /Demo Co LinkedIn launch/i.test(c.title)),
    ).toBe(false);

    const aPortal = a.find((r) => r.tool === "creative.sendToPortal")?.data as {
      assetId?: string;
      taskId?: string;
    };
    const bPortal = b.find((r) => r.tool === "creative.sendToPortal")?.data as {
      assetId?: string;
      taskId?: string;
    };
    expect(store.assets.get(aPortal!.assetId!)?.clientId).toBe(DEMO_CLIENT_ID);
    expect(store.assets.get(bPortal!.assetId!)?.clientId).toBe(
      DEMO_CLIENT_B_ID,
    );
    expect(store.tasks.get(aPortal!.taskId!)?.clientId).toBe(DEMO_CLIENT_ID);
    expect(store.tasks.get(bPortal!.taskId!)?.clientId).toBe(DEMO_CLIENT_B_ID);
  });
});
