import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveAgentAllowedTools,
  runAgentTools,
  runClientFunnelDraftTools,
  runExplicitClientAgentTool,
} from "./agent-tools";
import { getDemoStore } from "../demo-store";

// Explicit legal-identifier fixture for invoice-issuance tests only.
process.env.HRMNY_TAX_REGISTRATION_NUMBER = "100000000000003";

/** Matches demo-store seed client used by M4 fixtures. */
const CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";

describe("runAgentTools funnel writes", () => {
  beforeEach(() => {
    getDemoStore().resetM4Demo();
  });

  it("creates campaign draft and brief inside client sandbox", async () => {
    const results = await runClientFunnelDraftTools({
      allowedTools: [
        "tasks.create",
        "campaigns.draft",
        "briefs.draft",
        "crm.note",
        "portal.invite",
        "creative.sendToPortal",
      ],
      prompt:
        "Prepare LinkedIn launch cutdowns for UAE retail for alex@democo.example",
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
      next?: { creative?: string; delivery?: string };
    };
    expect(campaign?.status).toBe("draft");
    expect(campaign?.channel).toBe("linkedin");
    expect(
      (campaign as { next?: { creative?: string } }).next?.creative,
    ).toContain(CLIENT_ID);

    const brief = byTool["briefs.draft"]?.data as {
      briefId?: string;
      dorComplete?: boolean;
      taskId?: string;
      next?: { traffic?: string; delivery?: string };
    };
    expect(brief?.briefId).toBeTruthy();
    expect(brief?.dorComplete).toBe(true);
    expect(brief?.next?.traffic).toContain("/traffic?");
    expect(brief?.next?.traffic).toContain(brief!.taskId!);

    const createdTask = byTool["tasks.create"]?.data as {
      taskId?: string;
      next?: { delivery?: string; creative?: string; traffic?: string };
    };
    expect(createdTask?.next?.delivery).toContain(
      `clientId=${encodeURIComponent(CLIENT_ID)}`,
    );
    expect(createdTask?.next?.creative).toContain("/creative?");
    expect(createdTask?.next?.traffic).toBe(
      `/traffic?clientId=${encodeURIComponent(CLIENT_ID)}`,
    );

    const invite = byTool["portal.invite"]?.data as {
      portalPath?: string;
      onboardingPath?: string;
      deliveryMode?: string;
      portalInvite?: { portalPath?: string; onboardingPath?: string };
      next?: { portal?: string; onboarding?: string; client?: string };
    };
    expect(invite?.portalPath).toMatch(/\/portal\/login\/verify/);
    expect(invite?.portalPath).toContain(
      encodeURIComponent("/portal/approvals"),
    );
    expect(invite?.onboardingPath).toMatch(/\/portal\/login\/verify/);
    expect(invite?.onboardingPath).toContain(
      encodeURIComponent("/portal/onboarding"),
    );
    expect(invite?.portalInvite?.onboardingPath).toBe(invite?.onboardingPath);
    expect(invite?.next?.portal).toBe(invite?.portalPath);
    expect(invite?.next?.onboarding).toBe(invite?.onboardingPath);
    expect(invite?.next?.client).toContain(CLIENT_ID);
    expect(invite?.deliveryMode).toBe("mock");

    const portalAsset = byTool["creative.sendToPortal"]?.data as {
      assetId?: string;
      taskId?: string;
      portalHref?: string;
      mode?: string;
      next?: { creative?: string; delivery?: string; portal?: string };
    };
    expect(portalAsset?.assetId).toBeTruthy();
    expect(portalAsset?.taskId).toBeTruthy();
    expect(portalAsset?.portalHref).toBe(
      `/client-preview?client=${CLIENT_ID}#approvals`,
    );
    expect(portalAsset?.next?.portal).toBe(portalAsset?.portalHref);
    expect(portalAsset?.next?.creative).toContain(CLIENT_ID);
    expect(portalAsset?.next?.delivery).toContain(CLIENT_ID);
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

  it("opens a staff preview without minting an invite when Resend is live", async () => {
    vi.stubEnv("RESEND_MODE", "live");
    vi.stubEnv("RESEND_API_KEY", "synthetic-test-key");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const beforeTokens = getDemoStore().portalMagicTokens.size;
    try {
      const results = await runExplicitClientAgentTool({
        tool: "creative.sendToPortal",
        prompt: "Prepare a synthetic creative review package",
        scope: {
          clientId: CLIENT_ID,
          employeeId: "c0000000-0000-4000-8000-000000000001",
        },
      });
      expect(
        results.find((row) => row.tool === "creative.sendToPortal")?.ok,
      ).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getDemoStore().portalMagicTokens.size).toBe(beforeTokens);
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllEnvs();
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
    expect(data?.portalInvite).toBeNull();
    expect(data?.next?.portal).not.toContain("token=");
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

  it("finance.os_approve + finance.os_issue advance proposed invoice (prompt-gated)", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const loopResults = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run demo closed loop for company: Finance Agent Co",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const loop = loopResults.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.ok).toBe(true);
    const invoiceId = (loop?.data as { invoiceId?: string })?.invoiceId;
    expect(invoiceId).toBeTruthy();

    const approveBlocked = await runAgentTools({
      allowedTools: ["finance.os_approve"],
      prompt: `Summarize invoice ${invoiceId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(
      approveBlocked.find((r) => r.tool === "finance.os_approve"),
    ).toBeUndefined();

    const approved = await runAgentTools({
      allowedTools: ["finance.os_approve"],
      prompt: `Approve OS invoice invoiceId: ${invoiceId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const approve = approved.find((r) => r.tool === "finance.os_approve");
    expect(approve?.ok).toBe(true);
    expect((approve?.data as { status?: string })?.status).toBe("approved");

    const issued = await runAgentTools({
      allowedTools: ["finance.os_issue"],
      prompt: `Issue OS invoice invoiceId: ${invoiceId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const issue = issued.find((r) => r.tool === "finance.os_issue");
    expect(issue?.ok).toBe(true);
    const data = issue?.data as {
      status?: string;
      xeroWrite?: boolean;
      xeroInvoiceId?: string | null;
    };
    expect(data?.status).toBe("issued");
    expect(data?.xeroWrite).toBe(false);
    expect(data?.xeroInvoiceId ?? null).toBeNull();
  });

  it("client sandbox never runs finance.os_approve", async () => {
    const results = await runAgentTools({
      allowedTools: ["finance.os_approve"],
      prompt:
        "Approve OS invoice invoiceId: a1000000-0000-4000-8000-000000000099",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(
      results.find((r) => r.tool === "finance.os_approve"),
    ).toBeUndefined();
  });

  it("outreach.os_approve advances draft after closed loop (prompt-gated)", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const loopResults = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run demo closed loop for company: Outreach Agent Co",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const loop = loopResults.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.ok).toBe(true);
    const data = loop?.data as {
      outreachId?: string;
      next?: { approvals?: string };
    };
    expect(data?.outreachId).toBeTruthy();
    expect(data?.next?.approvals).toMatch(/id=/);

    const blocked = await runAgentTools({
      allowedTools: ["outreach.os_approve"],
      prompt: `Summarize outreach ${data?.outreachId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(
      blocked.find((r) => r.tool === "outreach.os_approve"),
    ).toBeUndefined();

    const approved = await runAgentTools({
      allowedTools: ["outreach.os_approve"],
      prompt: `Approve OS outreach outreachId: ${data?.outreachId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const row = approved.find((r) => r.tool === "outreach.os_approve");
    expect(row?.ok).toBe(true);
    expect((row?.data as { state?: string })?.state).toBe("approved");
  });

  it("client sandbox never runs outreach.os_approve", async () => {
    const results = await runAgentTools({
      allowedTools: ["outreach.os_approve"],
      prompt:
        "Approve OS outreach outreachId: a1000000-0000-4000-8000-000000000099",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(
      results.find((r) => r.tool === "outreach.os_approve"),
    ).toBeUndefined();
  });

  it("creative.os_qc passes QC on closed-loop task (prompt-gated)", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const loopResults = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run demo closed loop for company: Creative Qc Co",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const loop = loopResults.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.ok).toBe(true);
    const taskId = (loop?.data as { taskId?: string })?.taskId;
    expect(taskId).toBeTruthy();

    const blocked = await runAgentTools({
      allowedTools: ["creative.os_qc"],
      prompt: `Summarize task ${taskId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(blocked.find((r) => r.tool === "creative.os_qc")).toBeUndefined();

    const passed = await runAgentTools({
      allowedTools: ["creative.os_qc"],
      prompt: `Pass QC on creative taskId: ${taskId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const row = passed.find((r) => r.tool === "creative.os_qc");
    expect(row?.ok).toBe(true);
    expect((row?.data as { qcPassed?: boolean })?.qcPassed).toBe(true);
    expect((row?.data as { status?: string })?.status).toBe("client_review");
  });

  it("briefs.os_lock locks DoR-ready brief and spawns creative with next links", async () => {
    const { DEMO_BRIEF_ID, getDemoStore } = await import("../demo-store");
    getDemoStore().resetM4Demo();
    // Fill DoR to ≤2 missing (same as Traffic UI lock path).
    const store = getDemoStore();
    const brief = store.briefs.get(DEMO_BRIEF_ID)!;
    brief.body = {
      objective: "Grow",
      audience: "UAE retail",
      deliverables: "3 reels",
      deadline: "2026-09-30",
      brandAssets: { logo: true },
    };

    const blocked = await runAgentTools({
      allowedTools: ["briefs.os_lock"],
      prompt: `Summarize brief ${DEMO_BRIEF_ID}`,
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(blocked.find((r) => r.tool === "briefs.os_lock")).toBeUndefined();

    const locked = await runExplicitClientAgentTool({
      tool: "briefs.os_lock",
      prompt: `Lock the brief briefId: ${DEMO_BRIEF_ID}`,
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const row = locked.find((r) => r.tool === "briefs.os_lock");
    expect(row?.ok).toBe(true);
    const data = row?.data as {
      briefId?: string;
      spawnedTaskId?: string;
      taskStatus?: string;
      next?: { creative?: string; traffic?: string };
    };
    expect(data?.briefId).toBe(DEMO_BRIEF_ID);
    expect(data?.taskStatus).toBe("brief_ready");
    expect(data?.spawnedTaskId).toBeTruthy();
    expect(data?.next?.creative).toContain(CLIENT_ID);
    expect(data?.next?.creative).toContain(data!.spawnedTaskId!);
    expect(data?.next?.traffic).toContain("/traffic?");
    const spawn = store.tasks.get(data!.spawnedTaskId!);
    expect(spawn?.taskType).toBe("creative_spawn");
    expect(spawn?.clientId).toBe(CLIENT_ID);
  });

  it("campaigns.os_approve then os_publish stub after closed loop", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const loopResults = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run demo closed loop for company: Campaign Agent Co",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const loop = loopResults.find((r) => r.tool === "crm.closed_loop");
    expect(loop?.ok).toBe(true);
    const campaignItemId = (loop?.data as { campaignItemId?: string })
      ?.campaignItemId;
    expect(campaignItemId).toBeTruthy();

    const approved = await runAgentTools({
      allowedTools: ["campaigns.os_approve"],
      prompt: `Approve OS campaign campaignItemId: ${campaignItemId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const approve = approved.find((r) => r.tool === "campaigns.os_approve");
    expect(approve?.ok).toBe(true);
    expect((approve?.data as { status?: string })?.status).toBe("approved");

    const published = await runAgentTools({
      allowedTools: ["campaigns.os_publish"],
      prompt: `Publish OS campaign stub campaignItemId: ${campaignItemId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const pub = published.find((r) => r.tool === "campaigns.os_publish");
    expect(pub?.ok).toBe(true);
    const data = pub?.data as { status?: string; publishMode?: string };
    expect(data?.status).toBe("published");
    expect(data?.publishMode).toBe("stub");
  });

  it("keeps portal client decisions unavailable to agents and stale aliases", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const loopResults = await runAgentTools({
      allowedTools: ["crm.closed_loop"],
      prompt: "Run demo closed loop for company: Portal Approve Co",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const taskId = (
      loopResults.find((r) => r.tool === "crm.closed_loop")?.data as {
        taskId?: string;
      }
    )?.taskId;
    expect(taskId).toBeTruthy();

    const qc = await runAgentTools({
      allowedTools: ["creative.os_qc"],
      prompt: `Pass QC on creative taskId: ${taskId}`,
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(qc.find((r) => r.tool === "creative.os_qc")?.ok).toBe(true);
    expect(
      (qc.find((r) => r.tool === "creative.os_qc")?.data as { status?: string })
        ?.status,
    ).toBe("client_review");

    const store = getDemoStore();
    const { listCampaigns } = await import("../campaigns/repository");
    const { listOutreach } = await import("../leadgen/store");
    const snapshot = async () => ({
      tasks: [...store.tasks.values()].map(({ taskId: id, status }) => [
        id,
        status,
      ]),
      briefs: [...store.briefs.keys()],
      approvals: [...store.portalApprovals.entries()],
      assets: [...store.assets.entries()],
      audits: store.audits.length,
      health: store.healthSignals.length,
      seams: [...store.seamOutbox],
      magicTokens: [...store.portalMagicTokens.keys()],
      sessionGrants: [...store.portalSessionGrants.keys()],
      campaigns: (await listCampaigns()).map((row) => [
        row.campaignItemId,
        row.status,
      ]),
      outreach: (await listOutreach()).map((row) => row.id),
    });
    const before = await snapshot();
    const allowlists: unknown[] = [
      ...[
        "portal.os_approve",
        "portal_os_approve",
        "portal.approve",
        "portal.approvals",
        "portal.approvals.act",
        "portal.*",
        "*",
      ].map((tool) => [tool]),
      [],
      undefined,
    ];
    for (const allowedTools of allowlists) {
      const portal = await runAgentTools({
        allowedTools,
        prompt: `Approve OS portal taskId: ${taskId} for alex@democo.example`,
        scope: {
          clientId: CLIENT_ID,
          employeeId: "c0000000-0000-4000-8000-000000000001",
        },
      });
      expect(portal).toEqual([]);
      expect(await snapshot()).toEqual(before);
    }
    const paraphrase = await runAgentTools({
      allowedTools: ["*"],
      prompt: "Mark the client-review deliverable approved",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(
      paraphrase.every((row) =>
        [
          "memory.search",
          "crm.read",
          "crm.deals",
          "crm.companies",
          "delivery.read",
          "outreach.read",
          "onboarding.read",
          "n8n.health",
        ].includes(row.tool),
      ),
    ).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(resolveAgentAllowedTools(["portal.os_approve"])).toEqual([]);
    expect(resolveAgentAllowedTools(["portal_os_approve"])).toEqual([]);
    expect(resolveAgentAllowedTools(["portal.approve"])).toEqual([]);
    expect(resolveAgentAllowedTools(["portal.approvals"])).toEqual([]);
    expect(resolveAgentAllowedTools(["portal.approvals.act"])).toEqual([]);
  });

  it("one-shot OS settle chains closed_loop IDs into settle tools", async () => {
    const { resetCrmMemory } = await import("../crm/memory");
    resetCrmMemory();
    const { DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS } =
      await import("./agent-tools");
    const results = await runAgentTools({
      allowedTools: [...DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS],
      prompt:
        "Run closed loop then settle OS: finance approve and issue invoice, approve outreach, lock the brief, creative QC pass then advance to client review, approve campaign and publish campaign, sign off onboarding phase, advance month1, ref-approve calendar. company: OneShot Settle Co",
      scope: {
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });

    const byTool = (name: string) => results.find((r) => r.tool === name);
    expect(byTool("crm.closed_loop")?.ok).toBe(true);
    expect(byTool("finance.os_approve")?.ok).toBe(true);
    expect(byTool("finance.os_issue")?.ok).toBe(true);
    expect(
      (byTool("finance.os_issue")?.data as { status?: string })?.status,
    ).toBe("issued");
    expect(byTool("outreach.os_approve")?.ok).toBe(true);
    expect(byTool("briefs.os_lock")?.ok).toBe(true);
    expect(
      (byTool("briefs.os_lock")?.data as { spawnedTaskId?: string })
        ?.spawnedTaskId,
    ).toBeTruthy();
    expect(byTool("creative.os_qc")?.ok).toBe(true);
    expect(
      (byTool("creative.os_qc")?.data as { status?: string })?.status,
    ).toBe("client_review");
    expect(byTool("portal.os_approve")).toBeUndefined();
    const settledTaskId = (
      byTool("crm.closed_loop")?.data as {
        taskId?: string;
      }
    )?.taskId;
    expect(getDemoStore().tasks.get(settledTaskId!)?.status).toBe(
      "client_review",
    );
    expect(byTool("campaigns.os_approve")?.ok).toBe(true);
    expect(byTool("campaigns.os_publish")?.ok).toBe(true);
    expect(
      (byTool("campaigns.os_publish")?.data as { publishMode?: string })
        ?.publishMode,
    ).toBe("stub");
    expect(byTool("onboarding.os_signoff")?.ok).toBe(true);
    expect(byTool("clients.os_month1_advance")?.ok).toBe(true);
    expect(
      (byTool("clients.os_month1_advance")?.data as { toPhase?: number })
        ?.toPhase,
    ).toBe(1);
    expect(byTool("calendar.os_ref_approve")?.ok).toBe(true);
    expect(
      (byTool("calendar.os_ref_approve")?.data as { state?: string })?.state,
    ).toBe("ref_approved");
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
    const crm = results.find(
      (r) => r.tool === "crm.read" || r.tool === "crm.deals",
    );
    if (crm) expect(crm.ok).toBe(true);
  });

  it("falls back to read-only tools for an empty client-scoped allowlist", async () => {
    const results = await runAgentTools({
      allowedTools: [],
      prompt: "Create a note about sandbox fallback",
      scope: {
        clientId: CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    expect(results.some((r) => r.tool === "crm.read" && r.ok)).toBe(true);
    expect(results.find((r) => r.tool === "crm.note")).toBeUndefined();
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
    const { resetLeadgenStore, seedClientSandboxOutreach } =
      await import("../leadgen/store");
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

    const a = await runClientFunnelDraftTools({
      allowedTools: [...writes],
      prompt:
        "Demo Co LinkedIn launch cutdowns for UAE retail for alex@democo.example",
      scope: {
        clientId: DEMO_CLIENT_ID,
        employeeId: "c0000000-0000-4000-8000-000000000001",
      },
    });
    const b = await runClientFunnelDraftTools({
      allowedTools: [...writes],
      prompt:
        "Other Co confidential LinkedIn cutdowns for ops@otherco.example — keep private",
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
    expect(aCampaigns.some((c) => /Other Co confidential/i.test(c.title))).toBe(
      false,
    );
    expect(bCampaigns.some((c) => /Other Co confidential/i.test(c.title))).toBe(
      true,
    );
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
