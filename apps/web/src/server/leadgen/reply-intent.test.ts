import { describe, expect, it, vi } from "vitest";
import { pipelineStages } from "../crm/repository";
import { applyReplyIntent, intentToTransition, type MoveDealStage } from "./reply-intent";

const replies = vi.hoisted(() => ({
  honorUnsubscribe: vi.fn(async () => undefined),
}));

vi.mock("../sales-os/replies", () => ({
  honorUnsubscribe: replies.honorUnsubscribe,
}));

describe("reply-intent → deal-stage mapping", () => {
  it("maps positive intents to advance, passive intents to no move", () => {
    expect(intentToTransition).toEqual({
      interested: "engage",
      question: "engage",
      not_now: null,
      other: null,
      unsubscribe: null,
    });
  });

  it("every non-null target is a real pipeline stage (calibration invariant)", () => {
    const stageKeys = new Set<string>(pipelineStages().map((s) => s.key));
    for (const target of Object.values(intentToTransition)) {
      if (target !== null) expect(stageKeys.has(target)).toBe(true);
    }
  });

  it("applies a positive intent via moveDealStage", async () => {
    const move = vi.fn<MoveDealStage>().mockResolvedValue({ ok: true, deal: {} });
    const res = await applyReplyIntent({
      dealId: "d1",
      intent: "interested",
      moveDealStage: move,
    });
    expect(move).toHaveBeenCalledWith({
      dealId: "d1",
      to: "engage",
      actorEmployeeId: undefined,
    });
    expect(res).toEqual({ intent: "interested", toStage: "engage", moved: true });
  });

  it("does not move on a passive intent", async () => {
    const move = vi.fn<MoveDealStage>();
    const res = await applyReplyIntent({ dealId: "d1", intent: "not_now", moveDealStage: move });
    expect(move).not.toHaveBeenCalled();
    expect(res).toEqual({ intent: "not_now", toStage: null, moved: false });
  });

  it("records suppression on unsubscribe without a stage move", async () => {
    const move = vi.fn<MoveDealStage>();
    const res = await applyReplyIntent({
      dealId: "d1",
      intent: "unsubscribe",
      moveDealStage: move,
    });
    expect(move).not.toHaveBeenCalled();
    expect(res.toStage).toBeNull();
    expect(res.moved).toBe(false);
    expect(res.reason).toBe("suppressed_and_closed");
    expect(replies.honorUnsubscribe).toHaveBeenCalledWith({
      dealId: "d1",
      source: "reply-intent",
    });
  });

  it("surfaces a failed move reason", async () => {
    const move = vi
      .fn<MoveDealStage>()
      .mockResolvedValue({ ok: false, reason: "Deal not found" });
    const res = await applyReplyIntent({ dealId: "missing", intent: "question", moveDealStage: move });
    expect(res.moved).toBe(false);
    expect(res.reason).toBe("Deal not found");
  });
});
