import { describe, expect, it } from "vitest";
import {
  nextLinksFromToolData,
  nextLinksFromToolResults,
} from "./agent-next-links";

describe("nextLinksFromToolData", () => {
  it("extracts next.* path links and portalPath", () => {
    expect(
      nextLinksFromToolData({
        next: {
          account: "/account?clientId=c1",
          creative: "/creative?clientId=c1&taskId=t1",
          skip: "https://evil.example",
          empty: "",
        },
        portalPath: "/portal/verify?token=abc",
      }),
    ).toEqual([
      { href: "/account?clientId=c1", label: "account" },
      { href: "/creative?clientId=c1&taskId=t1", label: "creative" },
      { href: "/portal/verify?token=abc", label: "portal" },
    ]);
  });

  it("returns [] for non-objects", () => {
    expect(nextLinksFromToolData(null)).toEqual([]);
    expect(nextLinksFromToolData("x")).toEqual([]);
  });
});

describe("nextLinksFromToolResults", () => {
  it("dedupes across tool rows", () => {
    const links = nextLinksFromToolResults([
      { data: { next: { account: "/account?clientId=c1" } } },
      { data: { next: { account: "/account?clientId=c1", finance: "/finance?clientId=c1" } } },
      { data: null },
    ]);
    expect(links).toEqual([
      { href: "/account?clientId=c1", label: "account" },
      { href: "/finance?clientId=c1", label: "finance" },
    ]);
  });
});
