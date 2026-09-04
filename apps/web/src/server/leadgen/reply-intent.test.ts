import { describe, expect, it, vi } from "vitest";
import { pipelineStages } from "../crm/repository";
import {
  applyReplyIntent,
  intentToTransition,
  moveReplyDealStageThroughGates,
  type MoveDealStage,
} from "./reply-intent";

const replies = vi.hoisted(() => ({
  honorUnsubscribe: vi.fn(async () => undefined),
}));

vi.mock("../sales-os/replies", () => ({
  honorUnsubscribe: replies.honorUnsubscribe,
}));

describe("reply-intent → deal-stage mapping", () => {
  it("maps positive intents to advance, passive intents to no move", () => {
    expect(intentToTransition).toEqual({
      interested: "scope",
      question: "scope",
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
    const move = vi
      .fn<MoveDealStage>()
      .mockResolvedValue({ ok: true, deal: {} });
    const res = await applyReplyIntent({
      dealId: "d1",
      intent: "interested",
      moveDealStage: move,
    });
    expect(move).toHaveBeenCalledWith({
      dealId: "d1",
      to: "scope",
      actorEmployeeId: undefined,
    });
    expect(res).toEqual({
      intent: "interested",
      toStage: "scope",
      moved: true,
    });
  });

  it("moves engage to scope only after sent-copy and verified-email gates pass", async () => {
    const move = vi.fn<MoveDealStage>().mockResolvedValue({
      ok: true,
      deal: {},
    });
    const audit = vi.fn(async () => ({ auditId: "audit-1" }));
    const result = await moveReplyDealStageThroughGates(
      { dealId: "d1", to: "scope", actorEmployeeId: "employee-1" },
      {
        getDeal: vi.fn(async () => ({
          dealId: "d1",
          primaryContactId: "contact-1",
          companyName: "Northstar",
          stage: "engage",
        })) as never,
        getContact: vi.fn(async () => ({ emailVerified: true })) as never,
        listOutreach: vi.fn(async () => [
          {
            state: "sent",
            body: "Northstar, I noticed your regional launch and have one relevant idea to share.",
          },
        ]) as never,
        moveDealStage: move,
        audit,
      },
    );

    expect(result.ok).toBe(true);
    expect(move).toHaveBeenCalledWith({
      dealId: "d1",
      to: "scope",
      actorEmployeeId: "employee-1",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "deal.transition",
        entityId: "d1",
      }),
    );
  });

  it("blocks the reply move when the conversation was not sent", async () => {
    const move = vi.fn<MoveDealStage>();
    const result = await moveReplyDealStageThroughGates(
      { dealId: "d1", to: "scope" },
      {
        getDeal: vi.fn(async () => ({
          dealId: "d1",
          primaryContactId: "contact-1",
          companyName: "Northstar",
          stage: "engage",
        })) as never,
        getContact: vi.fn(async () => ({ emailVerified: true })) as never,
        listOutreach: vi.fn(async () => []) as never,
        moveDealStage: move,
        audit: vi.fn(async () => ({ auditId: "audit-blocked" })),
      },
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.ok || result.reason).toContain("Voice check not passed");
    expect(move).not.toHaveBeenCalled();
  });

  it("does not move on a passive intent", async () => {
    const move = vi.fn<MoveDealStage>();
    const res = await applyReplyIntent({
      dealId: "d1",
      intent: "not_now",
      moveDealStage: move,
    });
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
    const res = await applyReplyIntent({
      dealId: "missing",
      intent: "question",
      moveDealStage: move,
    });
    expect(res.moved).toBe(false);
    expect(res.reason).toBe("Deal not found");
  });
});
