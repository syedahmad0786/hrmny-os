import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: () => null,
}));

vi.mock("@hrmny/integrations", () => ({
  createResendMock: () => ({ mode: "mock", send: vi.fn() }),
}));

vi.mock("./portal-magic-link", () => ({
  sendPortalInviteMagicLink: vi.fn(async ({ clientId }: { clientId: string }) => ({
    portalPath: `/portal/login/verify?token=tok_${clientId.slice(0, 4)}`,
    delivery: { mode: "mock", id: "mock-1" },
  })),
}));

import { sendPortalInviteMagicLink } from "./portal-magic-link";
import { portalReviewHref } from "./portal-review-href";

describe("portalReviewHref", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns minted magic-link path for a client", async () => {
    const href = await portalReviewHref(
      "c1000000-0000-4000-8000-000000000001",
    );
    expect(href).toContain("/portal/login/verify?token=");
    expect(sendPortalInviteMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1000000-0000-4000-8000-000000000001",
        email: expect.stringMatching(/@example\.com$/),
      }),
    );
  });

  it("falls back to /portal/login when invite fails", async () => {
    vi.mocked(sendPortalInviteMagicLink).mockRejectedValueOnce(
      new Error("invite_failed"),
    );
    await expect(
      portalReviewHref("c1000000-0000-4000-8000-000000000002"),
    ).resolves.toBe("/portal/login");
  });

  it("returns /portal/login for empty clientId", async () => {
    await expect(portalReviewHref("  ")).resolves.toBe("/portal/login");
    expect(sendPortalInviteMagicLink).not.toHaveBeenCalled();
  });
});
