type SupabaseAdminEnv = Readonly<Record<string, string | undefined>>;

export function getSupabaseAdminConfig(
  env: SupabaseAdminEnv = process.env,
): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  return url && key ? { url, key } : null;
}
