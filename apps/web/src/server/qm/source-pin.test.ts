import { describe, expect, it } from "vitest";
import { HRMNY_QM_AUTHORITY_BOUNDARY, QM_UPSTREAM_PIN } from "./source-pin";

describe("QM upstream and HRMNY authority pins", () => {
  it("pins the reviewed stable upstream commit", () => {
    expect(QM_UPSTREAM_PIN).toEqual({
      repository: "https://github.com/yc-software/qm",
      version: "v0.1.5",
      commit: "d931fe963de3ac20b9a7526ea9a4873c0d8ed18e",
      license: "MIT",
      audience: "authenticated-internal-users",
      maturity: "experimental",
    });
  });

  it("keeps identity, approvals, and external effects outside QM", () => {
    expect(HRMNY_QM_AUTHORITY_BOUNDARY).toMatchObject({
      identityAuthority: "hrmny",
      approvalAuthority: "hrmny",
      operationalAuthority: "hrmny-postgresql",
      executionWorkspace: "qm",
      externalClientAccess: false,
      directExternalEffects: false,
      rawProductionCredentials: false,
    });
  });
});
