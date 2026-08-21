import { describe, expect, it } from "vitest";
import { sanitizePortalNextPath, withPortalNext } from "./portal-next";

describe("sanitizePortalNextPath", () => {
  it("allows portal paths and query strings", () => {
    expect(sanitizePortalNextPath("/portal/approvals")).toBe(
      "/portal/approvals",
    );
    expect(sanitizePortalNextPath("/portal/onboarding")).toBe(
      "/portal/onboarding",
    );
    expect(sanitizePortalNextPath("/portal/approvals?id=abc")).toBe(
      "/portal/approvals?id=abc",
    );
  });

  it("rejects open redirects and traversal", () => {
    expect(sanitizePortalNextPath("https://evil.example/")).toBeNull();
    expect(sanitizePortalNextPath("//evil.example")).toBeNull();
    expect(sanitizePortalNextPath("/portal/../admin")).toBeNull();
    expect(sanitizePortalNextPath("/login")).toBeNull();
    expect(sanitizePortalNextPath(null)).toBeNull();
    expect(sanitizePortalNextPath("  ")).toBeNull();
  });
});

describe("withPortalNext", () => {
  it("appends next to verify paths", () => {
    expect(
      withPortalNext("/portal/login/verify?token=abc", "/portal/approvals"),
    ).toBe(
      "/portal/login/verify?token=abc&next=%2Fportal%2Fapprovals",
    );
  });

  it("ignores unsafe next", () => {
    expect(
      withPortalNext("/portal/login/verify?token=abc", "https://evil"),
    ).toBe("/portal/login/verify?token=abc");
  });
});
