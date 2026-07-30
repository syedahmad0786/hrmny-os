"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/supabase-config";

let browserClient: SupabaseClient | null | undefined;

/** Cookie-backed browser client so edge middleware can see the session. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (browserClient !== undefined) return browserClient;

  const config = getSupabasePublicConfig();
  browserClient = config
    ? createBrowserClient(config.url, config.key)
    : null;
  return browserClient;
}
