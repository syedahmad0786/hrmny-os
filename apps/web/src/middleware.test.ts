import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateSession } = vi.hoisted(() => ({ updateSession: vi.fn() }));

vi.mock("@/lib/auth-mode", () => ({
  getAuthModeFromEnv: () => "supabase",
}));

vi.mock("@/lib/supabase/middleware", () => ({
  isPublicPath: (pathname: string) => pathname.startsWith("/api/"),
  updateSession,
}));

import { middleware } from "./middleware";

describe("middleware", () => {
  beforeEach(() => updateSession.mockReset());

  it("lets API handlers authenticate without a redundant edge request", async () => {
    updateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: { id: "user-1" },
    });

    const response = await middleware(
      new NextRequest("https://hrmny.test/api/trpc/auth.session"),
    );

    expect(response.status).toBe(200);
    expect(updateSession).not.toHaveBeenCalled();
  });
});
