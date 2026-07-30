import { describe, expect, it } from "vitest";
import {
  assertScheduledAllowed,
  defaultAutonomyPolicy,
  parseAutonomyPolicy,
  PolicyViolationError,
  SCHEDULED_ALLOWED_ACTIONS,
  SCHEDULED_FORBIDDEN_ACTIONS,
  type AutonomyPolicy,
} from "./policy";

const scheduled: AutonomyPolicy = {
  mode: "scheduled_research",
  allowedScheduledAgents: ["research"],
  updatedBy: "emp-1",
  updatedAt: new Date().toISOString(),
};

describe("assertScheduledAllowed", () => {
  it("permits every allowed action for an allow-listed agent in scheduled mode", () => {
    for (const action of SCHEDULED_ALLOWED_ACTIONS) {
      expect(() =>
        assertScheduledAllowed(scheduled, "research", action),
      ).not.toThrow();
    }
  });

  it("ALWAYS throws for every forbidden action, even allow-listed + scheduled", () => {
    for (const action of SCHEDULED_FORBIDDEN_ACTIONS) {
      let caught: unknown;
      try {
        assertScheduledAllowed(scheduled, "research", action);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect((caught as PolicyViolationError).violation).toBe("forbidden_action");
    }
  });

  it("blocks even research when mode is manual (no unattended activity)", () => {
    const manual = { ...scheduled, mode: "manual" as const };
    expect(() =>
      assertScheduledAllowed(manual, "research", "research"),
    ).toThrow(PolicyViolationError);
    try {
      assertScheduledAllowed(manual, "research", "research");
    } catch (err) {
      expect((err as PolicyViolationError).violation).toBe("mode_not_scheduled");
    }
  });

  it("blocks an agent that is not on the scheduled allow-list", () => {
    try {
      assertScheduledAllowed(scheduled, "finance-assist", "draft");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).violation).toBe("agent_not_allowlisted");
    }
  });
});

describe("policy parsing", () => {
  it("defaults to manual with an empty allow-list", () => {
    const p = defaultAutonomyPolicy();
    expect(p.mode).toBe("manual");
    expect(p.allowedScheduledAgents).toEqual([]);
  });

  it("parses a valid stored payload round-trip", () => {
    expect(parseAutonomyPolicy(scheduled)).toEqual(scheduled);
  });

  it("falls back to manual for a corrupt payload (never grants autonomy)", () => {
    expect(parseAutonomyPolicy({ mode: "yolo" }).mode).toBe("manual");
    expect(parseAutonomyPolicy(null).mode).toBe("manual");
  });
});
