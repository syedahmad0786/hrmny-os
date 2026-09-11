import { describe, expect, it, vi } from "vitest";
import {
  buildComposioAuthorizeLinkBody,
  ComposioApiError,
  createComposioLive,
} from "./live";

describe("buildComposioAuthorizeLinkBody", () => {
  it("includes callback_url when provided", () => {
    expect(
      buildComposioAuthorizeLinkBody({
        authConfigId: "ac_1",
        userId: "emp-1",
        callbackUrl: "https://hrmny-os.vercel.app/settings/connections",
      }),
    ).toEqual({
      auth_config_id: "ac_1",
      user_id: "emp-1",
      callback_url: "https://hrmny-os.vercel.app/settings/connections",
    });
  });

  it("omits callback_url when missing or blank", () => {
    expect(
      buildComposioAuthorizeLinkBody({
        authConfigId: "ac_1",
        userId: "emp-1",
      }),
    ).toEqual({
      auth_config_id: "ac_1",
      user_id: "emp-1",
    });
    expect(
      buildComposioAuthorizeLinkBody({
        authConfigId: "ac_1",
        userId: "emp-1",
        callbackUrl: "  ",
      }),
    ).toEqual({
      auth_config_id: "ac_1",
      user_id: "emp-1",
    });
  });
});

describe("Composio managed authorization", () => {
  it("uses only an exact managed toolkit auth config and denies a mismatched response", async () => {
    const posted: string[] = [];
    let configs = [
      {
        id: "ac_google",
        toolkit: { slug: "googlesuper" },
        name: "Google",
        auth_scheme: "OAUTH2",
        is_composio_managed: true,
        status: "ENABLED",
      },
      {
        id: "ac_canva",
        toolkit: { slug: "canva" },
        name: "Canva",
        auth_scheme: "OAUTH2",
        is_composio_managed: true,
        status: "ENABLED",
      },
    ];
    const fetchImpl = async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes("/auth_configs?")) {
        expect(url).toContain("toolkit_slug=canva");
        return new Response(JSON.stringify({ items: configs, next_cursor: null }));
      }
      posted.push(String(init?.body));
      return new Response(JSON.stringify({
        redirect_url: "https://backend.composio.dev/link/canva",
        connected_account_id: "ca_canva",
        expires_at: "2026-09-11T03:00:00Z",
      }));
    };
    const createManagedAuthConfig = vi.fn(async (toolkit: string) => ({
      id: `ac_created_${toolkit}`,
      toolkit,
      isComposioManaged: true,
    }));
    const client = createComposioLive({
      apiKey: "test",
      fetchImpl,
      createManagedAuthConfig,
    });
    await expect(client.authorize("employee-1", "canva")).resolves.toMatchObject({
      id: "ca_canva",
    });
    expect(JSON.parse(posted[0]!)).toMatchObject({ auth_config_id: "ac_canva" });

    configs = configs.filter((row) => row.toolkit.slug !== "canva");
    await expect(client.authorize("employee-1", "canva")).resolves.toMatchObject({
      id: "ca_canva",
    });
    expect(createManagedAuthConfig).toHaveBeenCalledWith("canva");
    expect(JSON.parse(posted[1]!)).toMatchObject({
      auth_config_id: "ac_created_canva",
    });

    const mismatched = createComposioLive({
      apiKey: "test",
      fetchImpl,
      createManagedAuthConfig: async () => ({
        id: "ac_wrong",
        toolkit: "googlesuper",
        isComposioManaged: true,
      }),
    });
    await expect(mismatched.authorize("employee-1", "canva")).rejects.toEqual(
      expect.objectContaining<Partial<ComposioApiError>>({ status: 502 }),
    );
    expect(posted).toHaveLength(2);
  });
});
