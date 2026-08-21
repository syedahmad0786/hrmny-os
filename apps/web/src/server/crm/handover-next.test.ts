import { describe, expect, it } from "vitest";
import { buildHandoverNextLinks } from "./handover-next";

describe("buildHandoverNextLinks", () => {
  it("scopes account/creative/client and falls back to portal login without invite", () => {
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
    });
    expect(next.client).toBe("/clients/c1000000-0000-4000-8000-000000000001");
    expect(next.account).toContain("clientId=");
    expect(next.creative).toContain("clientId=");
    expect(next.approvals).toBe("/approvals");
    expect(next.outreach).toBe("/crm/outreach");
    expect(next.portal).toBe("/portal/login");
    expect(next.onboarding).toBe("/portal/onboarding");
    expect(next.finance).toBe("/finance");
  });

  it("pins outreach + approvals to the draft id when present", () => {
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
      outreachId: "o-abc",
      invoiceId: "inv-1",
    });
    expect(next.outreach).toBe("/crm/outreach?id=o-abc");
    expect(next.approvals).toBe("/approvals?id=o-abc");
    expect(next.finance).toBe("/finance?invoiceId=inv-1");
  });

  it("uses portal magic-link path for portal + onboarding when invite exists", () => {
    const magic =
      "/portal/login/verify?token=ml_deadbeefcafebabe0123456789abcdef";
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
      portalPath: magic,
    });
    expect(next.portal).toBe(magic);
    expect(next.onboarding).toBe(magic);
  });
});
