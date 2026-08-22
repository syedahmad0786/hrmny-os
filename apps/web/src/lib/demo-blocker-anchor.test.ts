import { describe, expect, it } from "vitest";
import {
  demoBlockerAnchor,
  demoBlockerConnectionsPath,
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
});
