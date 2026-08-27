import { describe, expect, it } from "vitest";
import {
  demoBlockerAnchor,
  demoBlockerConnectionsPath,
  isOptionalLaterDemoBlocker,
  prioritizeDemoBlockers,
} from "./demo-blocker-anchor";

describe("demoBlockerAnchor", () => {
  it("maps ready blockers to Connections anchors", () => {
    expect(demoBlockerAnchor("Paste Apollo API key in Connections")).toBe(
      "#conn-apollo",
    );
    expect(demoBlockerConnectionsPath("Paste Hunter API key in Connections")).toBe(
      "/settings/connections#conn-hunter",
    );
    expect(demoBlockerAnchor("Reconnect Google Workspace: revoked")).toBe(
      "#conn-google_workspace",
    );
    expect(demoBlockerConnectionsPath("Set RESEND_MODE=live")).toBe(
      "/settings/connections#direct-business-connections",
    );
    expect(demoBlockerAnchor("unknown blocker")).toBeNull();
  });

  it("treats Apollo / Hunter / Xero as optional later", () => {
    expect(isOptionalLaterDemoBlocker("Paste Apollo API key in Connections")).toBe(
      true,
    );
    expect(
      isOptionalLaterDemoBlocker("Reconnect Google Workspace: revoked"),
    ).toBe(false);
  });

  it("sorts Google Workspace ahead of optional keys", () => {
    expect(
      prioritizeDemoBlockers([
        "Paste Apollo API key in Connections",
        "Reconnect Google Workspace: revoked",
        "Connect Xero OAuth in Connections",
      ])[0],
    ).toMatch(/Google Workspace/);
  });
});
