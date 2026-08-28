import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDemoStore } from "../demo-store";
import { durableHandoverPack } from "./handover";
import { getCrmMemory, resetCrmMemory } from "./memory";

const WON_DEAL_ID = "e0000000-0000-4000-8000-000000000005";

describe("memory CRM handover", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    resetCrmMemory();
    getDemoStore().resetM6Demo();
    const deal = getCrmMemory().deals.get(WON_DEAL_ID);
    if (!deal) throw new Error("missing won-deal fixture");
    deal.stage = "close";
    deal.closeOutcome = "won";
  });

  it("replays the same first creative task for one won deal", async () => {
    const first = await durableHandoverPack({ dealId: WON_DEAL_ID });
    const replay = await durableHandoverPack({ dealId: WON_DEAL_ID });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.client.clientId).toBe(first.client.clientId);
    expect(first.task).not.toBeNull();
    expect(replay.task).not.toBeNull();
    if (!first.task || !replay.task) return;
    expect(replay.task.taskId).toBe(first.task.taskId);
    expect(replay.task.briefId).toBe(first.task.briefId);
  });
});
