import { describe, expect, it } from "vitest";
import {
  formatGoogleWorkspaceGmailError,
  googleWorkspaceGmailApiEnableUrl,
  isGoogleWorkspaceReconnectRequired,
} from "./google-workspace-error";

describe("isGoogleWorkspaceReconnectRequired", () => {
  it("flags revoked / invalid_grant refresh failures", () => {
    expect(
      isGoogleWorkspaceReconnectRequired(
        "Google token refresh failed (400): Token has been expired or revoked.",
      ),
    ).toBe(true);
    expect(
      isGoogleWorkspaceReconnectRequired(
        "invalid_grant: Token has been revoked",
      ),
    ).toBe(true);
  });

  it("does not flag missing or transient copy", () => {
    expect(isGoogleWorkspaceReconnectRequired(null)).toBe(false);
    expect(isGoogleWorkspaceReconnectRequired("")).toBe(false);
    expect(
      isGoogleWorkspaceReconnectRequired(
        "Google OAuth client credentials are not configured",
      ),
    ).toBe(false);
  });
});

describe("Gmail API remediation", () => {
  const disabled =
    "Gmail API has not been used in project 815939408796 before or it is disabled.";

  it("links the exact Google Cloud project", () => {
    expect(googleWorkspaceGmailApiEnableUrl(disabled)).toBe(
      "https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=815939408796",
    );
  });

  it("turns provider JSON into an operator-safe error", () => {
    expect(formatGoogleWorkspaceGmailError(403, disabled)).toBe(
      "Gmail API is disabled for Google Cloud project 815939408796. Enable it, then retry; no email was sent.",
    );
    expect(googleWorkspaceGmailApiEnableUrl("invalid_grant")).toBeNull();
  });
});
