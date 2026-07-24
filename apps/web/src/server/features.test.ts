import { describe, expect, it } from "vitest";
import {
  FEATURE_BY_KEY,
  FEATURE_CATALOG,
  featureForPathname,
  featureForTrpcPath,
} from "@/features/catalog";
import { resolveFeature, type FeatureOverride } from "./features";

function override(
  scopeType: FeatureOverride["scopeType"],
  scopeKey: string,
  enabled: boolean,
): FeatureOverride {
  return {
    featureOverrideId: crypto.randomUUID(),
    featureKey: "work.projects",
    scopeType,
    scopeKey,
    enabled,
    reason: null,
    updatedByEmployeeId: null,
    updatedAt: new Date(0).toISOString(),
  };
}

describe("Feature Lab resolution", () => {
  it("enforces boundaries and supports an explicit user exception to role policy", () => {
    const project = FEATURE_BY_KEY.get("work.projects")!;
    expect(resolveFeature(project, []).enabled).toBe(true);
    expect(
      resolveFeature(project, [override("global", "global", false)], {
        userId: "user-1",
      }).enabled,
    ).toBe(false);
    expect(
      resolveFeature(project, [override("client", "client-1", false)], {
        clientId: "client-1",
        userId: "user-1",
      }).enabled,
    ).toBe(false);
    expect(
      resolveFeature(
        project,
        [override("role", "staff", false), override("user", "user-1", true)],
        { roles: ["staff"], userId: "user-1" },
      ).enabled,
    ).toBe(true);
  });

  it("never exposes planned features and keeps catalogue keys unique", () => {
    const planned = FEATURE_BY_KEY.get("work.rich_text")!;
    expect(
      resolveFeature(planned, [
        { ...override("global", "global", true), featureKey: planned.key },
      ]).enabled,
    ).toBe(false);
    expect(new Set(FEATURE_CATALOG.map((item) => item.key)).size).toBe(
      FEATURE_CATALOG.length,
    );
  });

  it("gates client preview at both the page and API boundary", () => {
    expect(featureForPathname("/client-preview")).toBe("portal.client");
    expect(featureForTrpcPath("clientPreview.workspace")).toBe("portal.client");
  });
});
