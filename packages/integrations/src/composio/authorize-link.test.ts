import { describe, expect, it } from "vitest";
import { buildComposioAuthorizeLinkBody } from "./live";

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
