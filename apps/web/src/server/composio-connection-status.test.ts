import { describe, expect, it } from "vitest";
import {
  findStaffConnectionRow,
  isActiveComposioRemote,
} from "./trpc/connections-router";

describe("findStaffConnectionRow", () => {
  it("prefers exact toolkit match over composio-prefixed row", () => {
    const rows = [
      { toolkit: "composio:canva", id: "composio" },
      { toolkit: "canva", id: "direct" },
    ];
    expect(findStaffConnectionRow(rows, "canva")?.id).toBe("direct");
  });

  it("falls back to composio:<toolkit> vault rows", () => {
    const rows = [{ toolkit: "composio:linkedin", id: "li" }];
    expect(findStaffConnectionRow(rows, "linkedin")?.id).toBe("li");
  });
});

describe("isActiveComposioRemote", () => {
  it("treats ACTIVE/CONNECTED/SUCCESS as connected", () => {
    expect(isActiveComposioRemote("ACTIVE")).toBe(true);
    expect(isActiveComposioRemote("connected")).toBe(true);
    expect(isActiveComposioRemote("SUCCESS")).toBe(true);
  });

  it("rejects disabled or pending accounts", () => {
    expect(isActiveComposioRemote("ACTIVE", true)).toBe(false);
    expect(isActiveComposioRemote("INITIATED")).toBe(false);
    expect(isActiveComposioRemote(null)).toBe(false);
  });
});
