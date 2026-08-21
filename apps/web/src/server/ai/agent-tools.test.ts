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
    expect(getDemoStore().briefs.has(brief!.briefId!)).toBe(true);
  });
});
