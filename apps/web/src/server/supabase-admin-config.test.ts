import { describe, expect, it } from "vitest";
import { getSupabaseAdminConfig } from "./supabase-admin-config";

describe("getSupabaseAdminConfig", () => {
  it("prefers the modern server secret key", () => {
    expect(
      getSupabaseAdminConfig({
        NEXT_PUBLIC_SUPABASE_URL: " https://project.supabase.co ",
        SUPABASE_SECRET_KEY: " sb_secret_live ",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      key: "sb_secret_live",
    });
  });

  it("supports the legacy service-role key during migration", () => {
    expect(
      getSupabaseAdminConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      key: "legacy-service-role",
    });
  });

  it("rejects incomplete configuration", () => {
    expect(
      getSupabaseAdminConfig({ SUPABASE_SECRET_KEY: "sb_secret_live" }),
    ).toBeNull();
  });
});
