import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDevUser,
  sessionCanViewMargin,
  type SessionUser,
} from "../auth/session";
import { createCaller } from "./root";

function caller(user: SessionUser) {
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

function sourceDrafts(
  sources: Array<{
    sourceKey: string;
    enabled: boolean;
    required: boolean;
    accountReferenceId: string | null;
    configuration: { url?: string; feedUrl?: string; notes?: string };
  }>,
) {
  return sources.map((source) => ({
    sourceKey: source.sourceKey,
    enabled: source.enabled,
    required: source.required,
    accountReferenceId: source.accountReferenceId,
    configuration: source.configuration,
  }));
}

describe("Discovery programme contract", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
  });

  it("keeps unverified source truth visible and rejects unsafe URLs", async () => {
    const am = caller(resolveDevUser("am"));
    const manifest = await am.salesOs.discovery.manifest();
    expect(manifest.executionEnabled).toBe(false);
    expect(
      manifest.sources.find((source) => source.sourceKey === "campaign_me"),
    ).toMatchObject({
      capabilityState: "candidate",
      connectionState: "not_required",
    });
    expect(
      manifest.sources.find((source) => source.sourceKey === "time_out_dubai"),
    ).toMatchObject({
      capabilityState: "blocked",
      required: true,
    });

    await expect(
      am.salesOs.discovery.programmes.create({
        config: manifest.config,
        sources: [
          {
            sourceKey: "campaign_me",
            enabled: true,
            required: true,
            configuration: { url: "https://127.0.0.1/private" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const omitted = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: [],
    });
    expect(omitted.draft.sources).toHaveLength(manifest.sources.length);
    expect(
      omitted.readiness.blockers.some(
        (blocker) =>
          blocker.sourceKey === "campaign_me" &&
          blocker.message.includes("required source is disabled"),
      ),
    ).toBe(true);

    const listingOnly = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: [
        {
          sourceKey: "campaign_me",
          enabled: true,
          required: true,
          configuration: { url: "https://campaignme.com/latest/" },
        },
      ],
    });
    const reopened = await am.salesOs.discovery.programmes.get({
      programmeId: listingOnly.id,
    });
    expect(
      reopened.draft.sources.find(
        (source) => source.sourceKey === "campaign_me",
      )?.configuration,
    ).toEqual({ url: "https://campaignme.com/latest/" });
  });

  it("enforces ownership, admin publish, and one-winner optimistic updates", async () => {
    const amUser = resolveDevUser("am");
    const am = caller(amUser);
    const partner = caller(resolveDevUser("partner"));
    const manifest = await am.salesOs.discovery.manifest();
    const created = await am.salesOs.discovery.programmes.create({
      config: manifest.config,
      sources: sourceDrafts(manifest.sources),
    });
    expect(created).toMatchObject({
      state: "draft",
      version: 1,
      draftVersion: 1,
      executionEnabled: false,
    });

    const otherAm = caller({
      ...amUser,
      employeeId: "c0000000-0000-4000-8000-000000000099",
      email: "other-am@hrmny.local",
    });
    await expect(
      otherAm.salesOs.discovery.programmes.get({ programmeId: created.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      am.salesOs.discovery.programmes.publish({
        programmeId: created.id,
        expectedVersion: created.version,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const editedConfig = {
      ...created.draft.config,
      purpose: `${created.draft.config.purpose} Updated.`,
    };
    const writes = await Promise.allSettled([
      am.salesOs.discovery.programmes.saveDraft({
        programmeId: created.id,
        expectedVersion: created.version,
        config: editedConfig,
        sources: sourceDrafts(created.draft.sources),
      }),
      am.salesOs.discovery.programmes.saveDraft({
        programmeId: created.id,
        expectedVersion: created.version,
        config: {
          ...editedConfig,
          purpose: `${editedConfig.purpose} Concurrent.`,
        },
        sources: sourceDrafts(created.draft.sources),
      }),
    ]);
    expect(writes.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = writes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: { code: "CONFLICT", message: "PROGRAMME_VERSION_CONFLICT" },
    });

    const fresh = await partner.salesOs.discovery.programmes.get({
      programmeId: created.id,
    });
    const published = await partner.salesOs.discovery.programmes.publish({
      programmeId: created.id,
      expectedVersion: fresh.version,
    });
    expect(published).toMatchObject({
      state: "active",
      publishedVersion: fresh.draftVersion,
      executionEnabled: false,
      nextDueAt: null,
    });
    expect(published.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "EXECUTION_DISABLED", sourceKey: null }),
    );
    await expect(
      partner.salesOs.discovery.programmes.pause({
        programmeId: created.id,
        expectedVersion: fresh.version,
        reason: "Stale pause attempt",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "PROGRAMME_VERSION_CONFLICT",
    });
    await expect(
      partner.salesOs.discovery.programmes.pause({
        programmeId: created.id,
        expectedVersion: published.version,
        reason: "Hold all future research configuration",
      }),
    ).resolves.toMatchObject({
      state: "paused",
      version: published.version + 1,
      executionEnabled: false,
    });
  });
});
