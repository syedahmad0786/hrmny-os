import { expect, it, vi } from "vitest";
import { GET } from "./route";
import { signGoogleWorkspaceOAuthState } from "@/server/google-workspace-oauth";
import { createCaller } from "@/server/trpc/root";
import { resolveDevUser } from "@/server/auth/session";

it("public callbacks only redirect, and only the initiating employee can complete the connection", async () => {
  vi.stubEnv("GOOGLE_OAUTH_STATE_SECRET", "g".repeat(32));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://hrmny-os.vercel.app");
  const user = resolveDevUser("partner");
  const state = signGoogleWorkspaceOAuthState(
    "c0000000-0000-4000-8000-000000000099",
  );
  const callback = new URL(
    "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback",
  );
  callback.search = new URLSearchParams({
    code: "unused-code",
    state,
  }).toString();
  const response = await GET(new Request(callback));
  const destination = new URL(response.headers.get("location")!);
  expect(destination.pathname).toBe("/settings/connections");
  expect(destination.search).toBe("");
  expect(new URLSearchParams(destination.hash.slice(1)).get("code")).toBe(
    "unused-code",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  const caller = createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: true,
  });
  await expect(
    caller.connections.completeGoogleWorkspaceOAuth({
      code: "unused-code",
      state,
    }),
  ).rejects.toThrow(/employee who started/);
  const anonymous = createCaller({
    user: null,
    employeeId: null,
    roles: [],
    canViewMargin: false,
  });
  await expect(
    anonymous.connections.completeGoogleWorkspaceOAuth({
      code: "unused-code",
      state,
    }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
