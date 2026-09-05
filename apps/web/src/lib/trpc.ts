import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/root";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export const trpc = createTRPCReact<AppRouter>();

const WORKSPACE_PREVIEW_KEY = "hrmny-workspace-preview";
export function getWorkspacePreview(): string | null {
  return typeof window === "undefined"
    ? null
    : sessionStorage.getItem(WORKSPACE_PREVIEW_KEY);
}
export function setWorkspacePreview(employeeId: string | null) {
  if (employeeId) sessionStorage.setItem(WORKSPACE_PREVIEW_KEY, employeeId);
  else sessionStorage.removeItem(WORKSPACE_PREVIEW_KEY);
}

export function getDevRole(): string {
  if (typeof window === "undefined") return "partner";
  return localStorage.getItem("hrmny-dev-role") ?? "partner";
}

export function setDevRole(role: string) {
  localStorage.setItem("hrmny-dev-role", role);
}

const PORTAL_GRANT_KEY = "hrmny-portal-grant";

export function getPortalGrant(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PORTAL_GRANT_KEY);
}

export function setPortalGrant(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(PORTAL_GRANT_KEY, token);
  else localStorage.removeItem(PORTAL_GRANT_KEY);
}

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch(url, options) {
          const signal = AbortSignal.any(
            // Closed-loop / Apollo import can exceed 20s on cold SQL demos.
            [options?.signal, AbortSignal.timeout(60_000)].filter(
              (item): item is AbortSignal => Boolean(item),
            ),
          );
          return fetch(url, { ...options, signal });
        },
        async headers() {
          const headers: Record<string, string> = {
            "x-dev-role": getDevRole(),
          };
          const grant = getPortalGrant();
          const preview = getWorkspacePreview();
          if (preview) headers["x-workspace-preview"] = preview;
          if (grant) headers["x-portal-grant"] = grant;
          const client = getSupabaseBrowserClient();
          if (client) {
            // getSession() can queue behind the OAuth hash-processing auth
            // lock on the landing page; a bounded wait keeps every query
            // progressing (the shell's auth listener refetches once the
            // session settles).
            const result = await Promise.race([
              client.auth.getSession(),
              new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), 3000),
              ),
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
