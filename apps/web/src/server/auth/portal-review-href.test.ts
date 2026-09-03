import { describe, expect, it } from "vitest";
import { portalReviewHref } from "./portal-review-href";

describe("portalReviewHref", () => {
  it("returns a read-only staff preview without minting client identity", async () => {
    const href = await portalReviewHref("c1000000-0000-4000-8000-000000000001");
    expect(href).toBe(
      "/client-preview?client=c1000000-0000-4000-8000-000000000001#approvals",
    );
    expect(href).not.toContain("token=");
  });

  it("keeps onboarding inside the staff workspace", async () => {
    await expect(
      portalReviewHref("c1000000-0000-4000-8000-000000000001", {
        next: "/portal/onboarding",
      }),
    ).resolves.toBe("/clients/c1000000-0000-4000-8000-000000000001#onboarding");
  });

  it("returns the client directory for an empty clientId", async () => {
    await expect(portalReviewHref("  ")).resolves.toBe("/clients");
  });
});
