import { describe, expect, it } from "vitest";
import { isGoogleWorkspaceReconnectRequired } from "./google-workspace-error";

describe("isGoogleWorkspaceReconnectRequired", () => {
  it("flags revoked / invalid_grant refresh failures", () => {
    expect(
      isGoogleWorkspaceReconnectRequired(
        "Google token refresh failed (400): Token has been expired or revoked.",
      ),
    ).toBe(true);
    expect(
      isGoogleWorkspaceReconnectRequired("invalid_grant: Token has been revoked"),
    ).toBe(true);
  });

  it("does not flag missing or transient copy", () => {
    expect(isGoogleWorkspaceReconnectRequired(null)).toBe(false);
    expect(isGoogleWorkspaceReconnectRequired("")).toBe(false);
    expect(
      isGoogleWorkspaceReconnectRequired("Google OAuth client credentials are not configured"),
    ).toBe(false);
  });
});
