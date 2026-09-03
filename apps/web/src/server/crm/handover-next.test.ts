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
    expect(next.approvals).toBe(
      "/approvals?clientId=c1000000-0000-4000-8000-000000000001",
    );
    expect(next.outreach).toBe(
      "/crm/outreach?clientId=c1000000-0000-4000-8000-000000000001",
    );
    expect(next.campaigns).toBe(
      "/creative?clientId=c1000000-0000-4000-8000-000000000001",
    );
    expect(next.portal).toBe(
      "/client-preview?client=c1000000-0000-4000-8000-000000000001#approvals",
    );
    expect(next.onboarding).toBe(
      "/clients/c1000000-0000-4000-8000-000000000001#onboarding",
    );
    expect(next.finance).toBe(
      "/finance?clientId=c1000000-0000-4000-8000-000000000001",
    );
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

  it("pins account to calendarId when present", () => {
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
      calendarId: "a3000000-0000-4000-8000-0000000000a4",
    });
    expect(next.account).toContain(
      "clientId=c1000000-0000-4000-8000-000000000001",
    );
    expect(next.account).toContain(
      "calendarId=a3000000-0000-4000-8000-0000000000a4",
    );
  });

  it("pins outreach + approvals to the draft id when present", () => {
    const next = buildHandoverNextLinks({
      clientId: "c1000000-0000-4000-8000-000000000001",
      outreachId: "o-abc",
      invoiceId: "inv-1",
      campaignItemId: "camp-1",
    });
    expect(next.outreach).toContain("clientId=c1000000-0000-4000-8000-000000000001");
    expect(next.outreach).toContain("id=o-abc");
    expect(next.approvals).toContain("clientId=c1000000-0000-4000-8000-000000000001");
    expect(next.approvals).toContain("id=o-abc");
    expect(next.finance).toContain("clientId=c1000000-0000-4000-8000-000000000001");
    expect(next.finance).toContain("invoiceId=inv-1");
    // Draft campaign ids must not land in Approvals (inbox is approved-only).
    expect(next.campaigns).toBe(
      "/creative?clientId=c1000000-0000-4000-8000-000000000001",
    );
    expect(next.campaigns).not.toContain("camp-1");
  });
});
