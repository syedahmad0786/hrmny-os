import { describe, expect, it } from "vitest";
import {
  findStaffConnectionRow,
  isActiveComposioRemote,
  pickActiveComposioAccount,
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

describe("pickActiveComposioAccount", () => {
  const remote = [
    {
      id: "stale",
      status: "INITIATED",
      is_disabled: false,
      toolkit: { slug: "canva" },
    },
    {
      id: "live",
      status: "ACTIVE",
      is_disabled: false,
      toolkit: { slug: "canva" },
    },
  ];

  it("skips stale INITIATED id and picks ACTIVE by toolkit", () => {
    expect(
      pickActiveComposioAccount({
        externalConnectionId: "stale",
        toolkitSlug: "canva",
        remote,
      })?.id,
    ).toBe("live");
  });

  it("keeps ACTIVE id match when stored link is live", () => {
    expect(
      pickActiveComposioAccount({
        externalConnectionId: "live",
        toolkitSlug: "canva",
        remote,
      })?.id,
    ).toBe("live");
  });

  it("returns undefined when no ACTIVE account exists", () => {
    expect(
      pickActiveComposioAccount({
        externalConnectionId: "stale",
        toolkitSlug: "canva",
        remote: [remote[0]!],
      }),
    ).toBeUndefined();
  });
});
