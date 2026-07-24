import { describe, expect, it } from "vitest";
import {
  hashBearerToken,
  ssoAccessAllowed,
  type WorkSsoConfiguration,
} from "./enterprise-identity";
import {
  parseScimFilter,
  SCIM,
  scimPatchInput,
  scimResourceTypes,
  scimSchemas,
} from "./scim";

const enforced: WorkSsoConfiguration = {
  status: "enforced",
  providerId: "provider-1",
  metadataUrl: null,
  domains: ["hrmny.com"],
  breakGlassEmails: ["owner@hrmny.com"],
  updatedAt: new Date(0).toISOString(),
};

describe("enterprise identity", () => {
  it("enforces the configured SAML identity only for governed domains", () => {
    expect(
      ssoAccessAllowed(enforced, {
        email: "person@hrmny.com",
        identities: [{ provider: "google" }],
      }),
    ).toBe(false);
    expect(
      ssoAccessAllowed(enforced, {
        email: "person@hrmny.com",
        identities: [{ provider: "sso:provider-1" }],
      }),
    ).toBe(true);
    expect(
      ssoAccessAllowed(enforced, {
        email: "owner@hrmny.com",
        identities: [{ provider: "email" }],
      }),
    ).toBe(true);
    expect(
      ssoAccessAllowed(enforced, {
        email: "guest@client.ae",
        identities: [{ provider: "email" }],
      }),
    ).toBe(true);
  });

  it("hashes bearer tokens and accepts only bounded SCIM equality filters", () => {
    expect(hashBearerToken("secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(parseScimFilter('userName eq "a@hrmny.com"', ["userName"])).toEqual({
      attribute: "username",
      value: "a@hrmny.com",
    });
    expect(() => parseScimFilter('userName co "hrmny"', ["userName"])).toThrow(
      "Only supported eq filters",
    );
  });

  it("accepts identity-provider PATCH casing and exposes single discovery records", () => {
    expect(
      scimPatchInput.parse({
        schemas: [SCIM.patch],
        Operations: [{ op: "Add", path: "active", value: true }],
      }).Operations[0]?.op,
    ).toBe("add");
    const request = new Request("https://portal.hrmny.com/api/scim/v2");
    expect(scimResourceTypes(request, "User")).toMatchObject({
      id: "User",
      endpoint: "/Users",
    });
    expect(scimSchemas(SCIM.group)).toMatchObject({ id: SCIM.group });
  });
});
