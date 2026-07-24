import { describe, expect, it } from "vitest";
import { isPublicAddress, signWorkWebhook } from "./work-api";

describe("Work API and webhook security", () => {
  it("blocks private and reserved webhook destinations", () => {
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("10.2.3.4")).toBe(false);
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("192.168.1.2")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("fc00::1")).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("signs timestamp and body together", () => {
    expect(signWorkWebhook("whsec_test", "1720000000", "hello")).toBe(
      "0d3067d71654c3666c86de805a9292e031d2e34f6d1385a3a36033b276f1f3b2",
    );
  });
});
