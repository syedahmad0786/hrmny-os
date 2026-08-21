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
});
