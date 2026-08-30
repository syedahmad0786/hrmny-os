import { describe, expect, it } from "vitest";
import { resolveAiAutonomyPolicy } from "./autonomy-policy";

const scheduled = {
  mode: "scheduled_research",
  allowedScheduledAgents: ["research"],
  updatedBy: "employee-1",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

describe("AI autonomy policy resolution", () => {
  it("accepts one valid active policy", () => {
    expect(resolveAiAutonomyPolicy([scheduled])).toEqual(scheduled);
  });

  it("fails closed when no active policy exists", () => {
    expect(resolveAiAutonomyPolicy([])).toMatchObject({
      mode: "manual",
      allowedScheduledAgents: [],
    });
  });

  it("fails closed when active policy rows conflict", () => {
    expect(resolveAiAutonomyPolicy([scheduled, scheduled])).toMatchObject({
      mode: "manual",
      allowedScheduledAgents: [],
    });
  });

  it("fails closed when the only active payload is invalid", () => {
    expect(
      resolveAiAutonomyPolicy([{ mode: "scheduled_research" }]),
    ).toMatchObject({
      mode: "manual",
      allowedScheduledAgents: [],
    });
  });
});
