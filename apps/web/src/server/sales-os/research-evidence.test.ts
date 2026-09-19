import { expect, it } from "vitest";
import { normalizeResearchEvidence } from "./research-evidence";

it("distinguishes ordinary fc/fd domains from private IPv6 addresses", () => {
  expect(normalizeResearchEvidence("https://fcb.com/news#story")).toBe(
    "https://fcb.com/news",
  );
  expect(normalizeResearchEvidence("https://fdic.gov/news")).toBe(
    "https://fdic.gov/news",
  );
  for (const host of [
    "[fc00::1]",
    "[fd00::1]",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "127.0.0.1",
  ])
    expect(() => normalizeResearchEvidence(`https://${host}/news`)).toThrow(
      /public HTTPS source/,
    );
});
