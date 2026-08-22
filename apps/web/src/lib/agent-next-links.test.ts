import { describe, expect, it } from "vitest";
import {
  nextLinksFromChatObservation,
  nextLinksFromToolData,
  nextLinksFromToolResults,
} from "./agent-next-links";

describe("nextLinksFromToolData", () => {
  it("extracts next.* path links, portalPath, portalHref, and portalInvite", () => {
    expect(
      nextLinksFromToolData({
        next: {
          account: "/account?clientId=c1",
          creative: "/creative?clientId=c1&taskId=t1",
          skip: "https://evil.example",
          empty: "",
        },
        portalPath: "/portal/login/verify?token=abc",
        portalHref: "/portal/login/verify?token=def",
        portalInvite: {
          portalPath: "/portal/login/verify?token=ghi&next=%2Fportal%2Fapprovals",
          onboardingPath:
            "/portal/login/verify?token=jkl&next=%2Fportal%2Fonboarding",
        },
      }),
    ).toEqual([
      { href: "/account?clientId=c1", label: "account" },
      { href: "/creative?clientId=c1&taskId=t1", label: "creative" },
      { href: "/portal/login/verify?token=abc", label: "portal" },
      { href: "/portal/login/verify?token=def", label: "portal" },
      {
        href: "/portal/login/verify?token=ghi&next=%2Fportal%2Fapprovals",
        label: "portal",
      },
      {
        href: "/portal/login/verify?token=jkl&next=%2Fportal%2Fonboarding",
        label: "onboarding",
      },
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
      {
        data: {
          next: { account: "/account?clientId=c1", finance: "/finance?clientId=c1" },
        },
      },
      { data: null },
    ]);
    expect(links).toEqual([
      { href: "/account?clientId=c1", label: "account" },
      { href: "/finance?clientId=c1", label: "finance" },
    ]);
  });
});

describe("nextLinksFromChatObservation", () => {
  it("parses agent_act tools JSON and surfaces next chips", () => {
    const observation = JSON.stringify({
      tools: [
        {
          tool: "crm.closed_loop",
          ok: true,
          data: {
            next: {
              account: "/account?clientId=c1",
              creative: "/creative?clientId=c1",
            },
            portalInvite: {
              portalPath: "/portal/login/verify?token=p1",
              onboardingPath: "/portal/login/verify?token=o1",
            },
          },
        },
      ],
    });
    expect(nextLinksFromChatObservation(observation)).toEqual([
      { href: "/account?clientId=c1", label: "account" },
      { href: "/creative?clientId=c1", label: "creative" },
      { href: "/portal/login/verify?token=p1", label: "portal" },
      { href: "/portal/login/verify?token=o1", label: "onboarding" },
    ]);
  });

  it("prefers leading nextLinks and recovers them from truncated JSON", () => {
    const links = [
      { href: "/account?clientId=c1", label: "account" },
      { href: "/portal/login/verify?token=p1", label: "portal" },
    ];
    expect(
      nextLinksFromChatObservation(
        JSON.stringify({ nextLinks: links, tools: [] }),
      ),
    ).toEqual(links);
    const truncated = `{"nextLinks":${JSON.stringify(links)},"tools":[{"tool":"crm.read","ok":true,"data":{"dealCount":99,"deals":[`;
    expect(nextLinksFromChatObservation(truncated)).toEqual(links);
  });
});
