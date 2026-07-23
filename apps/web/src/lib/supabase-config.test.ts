import { describe, expect, it } from "vitest";
import { getSupabasePublicConfig } from "./supabase-config";

describe("getSupabasePublicConfig", () => {
  it("prefers a publishable key for new projects", () => {
    expect(
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: " https://project.supabase.co ",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_live ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      key: "sb_publishable_live",
    });
  });

  it("supports the legacy anon key during migration", () => {
    expect(
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon",
      }),
    ).toEqual({
      url: "https://project.supabase.co",
      key: "legacy-anon",
    });
  });

  it("rejects incomplete configuration", () => {
    expect(
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      }),
    ).toBeNull();
  });
});
