import { afterEach, describe, expect, it } from "vitest";
import { featureForTrpcPath, FEATURE_BY_KEY } from "@/features/catalog";
import {
  assertSeparateSandbox,
  resetSandboxDatabase,
  type WorkEnvironmentManifest,
} from "./work-sandbox";

const originalKind = process.env.WORK_ENVIRONMENT_KIND;
const originalReset = process.env.WORK_SANDBOX_ALLOW_RESET;

afterEach(() => {
  if (originalKind === undefined) delete process.env.WORK_ENVIRONMENT_KIND;
  else process.env.WORK_ENVIRONMENT_KIND = originalKind;
  if (originalReset === undefined) delete process.env.WORK_SANDBOX_ALLOW_RESET;
  else process.env.WORK_SANDBOX_ALLOW_RESET = originalReset;
});

const production: WorkEnvironmentManifest = {
  environmentId: "production",
  kind: "production",
  appOrigin: "https://app.hrmny.test",
  databaseFingerprint: "production-db",
  authFingerprint: "shared-auth",
  schemaReady: true,
};

const sandbox: WorkEnvironmentManifest = {
  environmentId: "sandbox",
  kind: "sandbox",
  appOrigin: "https://sandbox.hrmny.test",
  databaseFingerprint: "sandbox-db",
  authFingerprint: "shared-auth",
  schemaReady: true,
};

describe("Work sandbox isolation", () => {
  it("accepts a migrated sandbox on a different database", () => {
    expect(() =>
      assertSeparateSandbox(production, sandbox, "https://sandbox.hrmny.test"),
    ).not.toThrow();
    expect(FEATURE_BY_KEY.get("work.sandboxes")?.availability).toBe("beta");
    expect(featureForTrpcPath("workAdmin.sandboxes.activate")).toBe(
      "work.sandboxes",
    );
  });

  it("rejects targets that share production identity or database", () => {
    expect(() =>
      assertSeparateSandbox(
        production,
        { ...sandbox, kind: "production" },
        sandbox.appOrigin,
      ),
    ).toThrow(/identify itself as a sandbox/i);
    expect(() =>
      assertSeparateSandbox(
        production,
        { ...sandbox, databaseFingerprint: production.databaseFingerprint },
        sandbox.appOrigin,
      ),
    ).toThrow(/different databases/i);
    expect(() =>
      assertSeparateSandbox(
        production,
        { ...sandbox, appOrigin: "https://wrong.hrmny.test" },
        sandbox.appOrigin,
      ),
    ).toThrow(/configured URL/i);
  });

  it("refuses reset outside an explicitly resettable sandbox", async () => {
    process.env.WORK_ENVIRONMENT_KIND = "production";
    process.env.WORK_SANDBOX_ALLOW_RESET = "true";
    await expect(resetSandboxDatabase("production")).rejects.toThrow(
      /only available inside a sandbox/i,
    );

    process.env.WORK_ENVIRONMENT_KIND = "sandbox";
    process.env.WORK_SANDBOX_ALLOW_RESET = "false";
    await expect(resetSandboxDatabase("sandbox")).rejects.toThrow(
      /reset is disabled/i,
    );
  });
});
