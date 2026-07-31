import { beforeEach, describe, expect, it } from "vitest";
import { DEV_USERS } from "./auth/session";
import { getDemoStore } from "./demo-store";
import {
  clearDemoFeatureOverrides,
  removeFeatureOverride,
  setFeatureOverride,
} from "./features";

describe("feature override audit", () => {
  beforeEach(() => clearDemoFeatureOverrides());

  it("records the prior value and removal through the mutation boundary", async () => {
    const actor = DEV_USERS.partner!.employeeId;
    await setFeatureOverride({
      featureKey: "work.ai.studio",
      scopeType: "global",
      scopeKey: "global",
      enabled: false,
      reason: "Disable for proof",
      updatedByEmployeeId: actor,
    });
    await setFeatureOverride({
      featureKey: "work.ai.studio",
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      reason: "Enable for proof",
      updatedByEmployeeId: actor,
    });

    const upsert = getDemoStore().audits.find(
      (row) =>
        row.action === "feature_override.upsert" &&
        row.reason === "Enable for proof",
    );
    expect(upsert?.before).toMatchObject({ enabled: false });
    expect(upsert?.after).toMatchObject({ enabled: true });

    await removeFeatureOverride({
      featureKey: "work.ai.studio",
      scopeType: "global",
      scopeKey: "global",
      updatedByEmployeeId: actor,
    });
    const removed = getDemoStore().audits.find(
      (row) => row.action === "feature_override.remove",
    );
    expect(removed?.before).toMatchObject({ enabled: true });
    expect(removed?.after).toBeNull();
  });
});
