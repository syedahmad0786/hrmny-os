import { describe, expect, it } from "vitest";
import { buildDemoBlockers } from "./smoke";

const emptyConnections = {
  googleWorkspace: 0,
  canva: 0,
  linkedin: 0,
  xero: 0,
  errors: {
    googleWorkspace: 0,
    canva: 0,
    linkedin: 0,
    xero: 0,
  },
  lastErrors: {
    googleWorkspace: null,
    canva: null,
    linkedin: null,
    xero: null,
  },
};

describe("buildDemoBlockers", () => {
  it("does not wall Hunt when optional tools are mock or disconnected", () => {
    const blockers = buildDemoBlockers({
      tools: {
        apollo: "mock",
        hunter: "mock",
        xero: "mock",
        resend: "mock",
      },
      connections: emptyConnections,
    });
    expect(blockers).toEqual([]);
  });

  it("does not treat a Google Workspace lastError as a product blocker", () => {
    expect(
      buildDemoBlockers({
        tools: { apollo: "live", hunter: "live", xero: "live", resend: "live" },
        connections: {
          ...emptyConnections,
          errors: { ...emptyConnections.errors, googleWorkspace: 1 },
          lastErrors: {
            ...emptyConnections.lastErrors,
            googleWorkspace: "Google token refresh failed (400): invalid_grant",
          },
        },
      }),
    ).toEqual([]);
  });

  it("stays empty when everything is live", () => {
    expect(
      buildDemoBlockers({
        tools: {
          apollo: "live",
          hunter: "live",
          xero: "live",
          resend: "live",
        },
        connections: {
          ...emptyConnections,
          googleWorkspace: 1,
          canva: 1,
          linkedin: 1,
          xero: 1,
        },
      }),
    ).toEqual([]);
  });
});
