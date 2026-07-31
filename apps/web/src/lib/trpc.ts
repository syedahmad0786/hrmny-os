import { createTRPCReact } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
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
      httpLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch(url, options) {
          const signal = AbortSignal.any(
            [options?.signal, AbortSignal.timeout(20_000)].filter(
              (item): item is AbortSignal => Boolean(item),
            ),
          );
          return fetch(url, { ...options, signal });
        },
        async headers() {
          const headers: Record<string, string> = {
            "x-dev-role": getDevRole(),
          };
          const client = getSupabaseBrowserClient();
          if (client) {
            // getSession() can queue behind the OAuth hash-processing auth
            // lock on the landing page; a bounded wait keeps every query
            // progressing (the shell's auth listener refetches once the
            // session settles).
            const result = await Promise.race([
              client.auth.getSession(),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
            ]);
            const token = result?.data.session?.access_token;
            if (token) headers.authorization = `Bearer ${token}`;
          }
          return headers;
        },
      }),
    ],
  });
}
