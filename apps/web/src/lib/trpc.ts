import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/root";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export const trpc = createTRPCReact<AppRouter>();

export function getDevRole(): string {
  if (typeof window === "undefined") return "partner";
  return localStorage.getItem("hrmny-dev-role") ?? "partner";
}

export function setDevRole(role: string) {
  localStorage.setItem("hrmny-dev-role", role);
}

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        async headers() {
          const headers: Record<string, string> = {
            "x-dev-role": getDevRole(),
          };
          const { data } =
            (await getSupabaseBrowserClient()?.auth.getSession()) ??
            { data: { session: null } };
          if (data.session?.access_token) {
            headers.authorization = `Bearer ${data.session.access_token}`;
          }
          return headers;
        },
      }),
    ],
  });
}
