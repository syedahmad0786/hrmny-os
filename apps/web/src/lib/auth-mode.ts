export type AuthMode = "dev" | "supabase";

export function getAuthModeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthMode {
  if (["preview", "production"].includes(env.VERCEL_ENV ?? ""))
    return "supabase";
  if (env.NODE_ENV === "production" && env.ALLOW_DEV_AUTH !== "true")
    return "supabase";
  return env.AUTH_MODE?.toLowerCase() === "supabase" ? "supabase" : "dev";
}
