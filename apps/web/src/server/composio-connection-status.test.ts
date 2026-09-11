import { describe, expect, it } from "vitest";
import {
  findStaffConnectionRow,
  isActiveComposioRemote,
  pickActiveComposioAccount,
  composioConnectionsCallbackUrl,
  selectOwnedActiveComposioAccount,
} from "./trpc/connections-router";

describe("composioConnectionsCallbackUrl", () => {
  it("points at settings connections under APP_URL", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://hrmny-os.vercel.app";
    try {
      expect(composioConnectionsCallbackUrl()).toBe(
        "https://hrmny-os.vercel.app/settings/connections",
      );
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });
});

describe("selectOwnedActiveComposioAccount", () => {
  const account = (id: string, userId = "employee-a") => ({
    id,
    user_id: userId,
    status: "ACTIVE",
    toolkit: { slug: "canva" },
  });

  it("requires selection for multiple accounts and resolves the exact owned id", () => {
    const remote = [account("one"), account("two")];
    expect(() =>
      selectOwnedActiveComposioAccount({
        employeeId: "employee-a",
        toolkitSlug: "canva",
        remote,
      }),
    ).toThrow("ACCOUNT_SELECTION_REQUIRED");
    expect(
      selectOwnedActiveComposioAccount({
        employeeId: "employee-a",
        toolkitSlug: "canva",
        connectedAccountId: "two",
        remote,
      })?.id,
    ).toBe("two");
  });

  it("denies an exact id owned by another employee", () => {
    expect(() =>
      selectOwnedActiveComposioAccount({
        employeeId: "employee-a",
        toolkitSlug: "canva",
        connectedAccountId: "other",
        remote: [account("other", "employee-b")],
      }),
    ).toThrow("ACCOUNT_NOT_OWNED");
  });
});

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

  it("does not replace a stale bound id with another active account", () => {
    expect(
      pickActiveComposioAccount({
        externalConnectionId: "stale",
        toolkitSlug: "canva",
        remote,
      }),
    ).toBeUndefined();
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

  it("rejects an ACTIVE stored id for a different toolkit", () => {
    const gmail = {
      id: "wrong-toolkit",
      status: "ACTIVE",
      toolkit: { slug: "gmail" },
    };
    expect(
      pickActiveComposioAccount({
        externalConnectionId: gmail.id,
        toolkitSlug: "canva",
        remote: [gmail],
      }),
    ).toBeUndefined();
  });

  it("keeps two same-toolkit accounts isolated by their exact remote ids", () => {
    const second = { ...remote[1]!, id: "live-two" };
    expect(
      ["live", "live-two"].map(
        (externalConnectionId) =>
          pickActiveComposioAccount({
            externalConnectionId,
            toolkitSlug: "canva",
            remote: [remote[1]!, second],
          })?.id,
      ),
    ).toEqual(["live", "live-two"]);
  });
});
