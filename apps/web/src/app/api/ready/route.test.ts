import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDemoWorkGovernance,
  getWorkOrganizationPolicy,
  saveWorkOrganizationPolicy,
} from "@/server/work-governance";
import { GET } from "./route";

describe("/api/ready", () => {
  beforeEach(() => clearDemoWorkGovernance());

  it("returns llm and platform fields without secrets", async () => {
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(body.ok ? 200 : 503);
    expect(body).toHaveProperty("llmProvider");
    expect(body).toHaveProperty("llmDefaultModel");
    expect(body).toHaveProperty("llmFreeOnly");
    expect(body).toHaveProperty("database");
    expect(body).toHaveProperty("pgvector");
    expect(body).toHaveProperty("integrationInbox");
    expect(body).toHaveProperty("surfaces.googleChat.eventUrl");
    expect(body).toHaveProperty("surfaces.gbrain.upstreamRevision");
    expect(body).toHaveProperty("surfaces.qm.plannedUrl");
    expect(body).toHaveProperty("tools");
    expect(body).toHaveProperty("tools.salesUnsubscribe");
    expect(body).toHaveProperty("blockers");
    expect(body).not.toHaveProperty("OPENROUTER_API_KEY");
  });

  it("is read-only and preserves a disabled connected-app policy", async () => {
    await saveWorkOrganizationPolicy(
      {
        approvedDomains: [],
        defaultProjectPrivacy: "organization",
        defaultTeamPrivacy: "request",
        guestInvitePolicy: "admins",
        externalSharingEnabled: true,
        appPolicy: "disabled",
        sessionTimeoutMinutes: 720,
      },
      "00000000-0000-4000-8000-000000000001",
    );

    const before = await getWorkOrganizationPolicy();
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    const after = await getWorkOrganizationPolicy();

    expect(body.connectedAppPolicy).toBe("disabled");
    expect(after).toEqual(before);
  });
});
