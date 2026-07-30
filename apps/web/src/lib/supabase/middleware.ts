import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase-config";

/**
 * Refresh the Supabase auth cookie session on the edge and optionally redirect
 * anonymous users away from staff/portal shells when AUTH_MODE=supabase.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabasePublicConfig();
  if (!config || process.env.AUTH_MODE !== "supabase") {
    return { response, user: null as null | { id: string } };
  }

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Parameters<typeof response.cookies.set>[2];
        }>,
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

export function isPublicPath(pathname: string): boolean {
  if (
    pathname === "/login" ||
    pathname === "/portal/login" ||
    pathname.startsWith("/portal/login/") ||
    pathname.startsWith("/forms/") ||
    pathname.startsWith("/card/") ||
    pathname.startsWith("/api/")
  ) {
    return true;
  }
  return false;
}
