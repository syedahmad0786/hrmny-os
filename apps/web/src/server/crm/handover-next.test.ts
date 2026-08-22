import { describe, expect, it } from "vitest";
import { buildHandoverNextLinks } from "./handover-next";

describe("buildHandoverNextLinks", () => {
  it("scopes account/creative/client and falls back without invites", () => {
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
    });
    expect(next.client).toBe("/clients/c1000000-0000-4000-8000-000000000001");
    expect(next.account).toContain("clientId=");
    expect(next.creative).toBe(
      "/creative?clientId=c1000000-0000-4000-8000-000000000001",
    );
    expect(next.creative).not.toContain("taskId=");
    expect(next.approvals).toBe("/approvals");
    expect(next.outreach).toBe("/crm/outreach");
    expect(next.campaigns).toBe("/approvals");
    expect(next.portal).toBe("/portal/login");
    expect(next.onboarding).toBe("/portal/onboarding");
    expect(next.finance).toBe("/finance");
  });

  it("pins creative to seeded QC taskId when present", () => {
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
      taskId: "b2000000-0000-4000-8000-0000000000a4",
    });
    expect(next.creative).toContain(
      "clientId=c1000000-0000-4000-8000-000000000001",
    );
    expect(next.creative).toContain(
      "taskId=b2000000-0000-4000-8000-0000000000a4",
    );
  });

  it("pins outreach + approvals to the draft id when present", () => {
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
      outreachId: "o-abc",
      invoiceId: "inv-1",
      campaignItemId: "camp-1",
    });
    expect(next.outreach).toBe("/crm/outreach?id=o-abc");
    expect(next.approvals).toBe("/approvals?id=o-abc");
    expect(next.finance).toBe("/finance?invoiceId=inv-1");
    expect(next.campaigns).toBe("/approvals?id=camp-1");
  });

  it("uses distinct magic-link paths for portal vs onboarding", () => {
    const portal =
      "/portal/login/verify?token=ml_portal_deadbeefcafebabe01234567&next=%2Fportal%2Fapprovals";
    const onboarding =
      "/portal/login/verify?token=ml_onboard_deadbeefcafebabe0123456&next=%2Fportal%2Fonboarding";
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
      portalPath: portal,
      onboardingPath: onboarding,
    });
    expect(next.portal).toBe(portal);
    expect(next.onboarding).toBe(onboarding);
    expect(next.portal).not.toBe(next.onboarding);
    expect(next.portal).not.toContain("ml_onboard_");
    expect(next.onboarding).not.toContain("ml_portal_");
  });
});
