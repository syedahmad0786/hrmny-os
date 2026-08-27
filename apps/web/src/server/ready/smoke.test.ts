import { describe, expect, it } from "vitest";
import { buildDemoBlockers } from "./smoke";

describe("buildDemoBlockers", () => {
  it("lists mock tools and zero connections", () => {
    const blockers = buildDemoBlockers({
      tools: {
        apollo: "mock",
        hunter: "mock",
        xero: "mock",
        resend: "mock",
      },
      connections: {
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
      },
    });
    expect(blockers.some((b) => /Apollo/i.test(b))).toBe(true);
    expect(blockers.some((b) => /Hunter/i.test(b))).toBe(false);
    expect(blockers.some((b) => /Xero/i.test(b))).toBe(true);
    expect(blockers.some((b) => /Google Workspace/i.test(b))).toBe(true);
    expect(blockers.some((b) => /LinkedIn/i.test(b))).toBe(true);
    expect(blockers.some((b) => /stub publish/i.test(b))).toBe(true);
    expect(blockers.some((b) => /Canva/i.test(b))).toBe(true);
    expect(blockers.some((b) => /stub list/i.test(b))).toBe(true);
    expect(blockers.some((b) => /RESEND/i.test(b))).toBe(true);
  });

  it("surfaces googleWorkspace lastError snippet", () => {
    const blockers = buildDemoBlockers({
      tools: { apollo: "live", hunter: "live", xero: "live", resend: "live" },
      connections: {
        googleWorkspace: 0,
        canva: 1,
        linkedin: 1,
        xero: 1,
        errors: {
          googleWorkspace: 1,
          canva: 0,
          linkedin: 0,
          xero: 0,
        },
        lastErrors: {
          googleWorkspace:
            "Google token refresh failed (400): invalid_grant",
          canva: null,
          linkedin: null,
          xero: null,
        },
      },
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/invalid_grant/);
    expect(blockers[0]).toMatch(/Google Workspace/);
  });

  it("returns empty when everything live", () => {
    expect(
      buildDemoBlockers({
        tools: {
          apollo: "live",
          hunter: "live",
          xero: "live",
          resend: "live",
        },
        connections: {
          googleWorkspace: 1,
          canva: 1,
          linkedin: 1,
          xero: 1,
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
        },
      }),
    ).toEqual([]);
  });
});
