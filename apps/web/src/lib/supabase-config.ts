type SupabasePublicEnv = Readonly<Record<string, string | undefined>>;

export function getSupabasePublicConfig(
  env: SupabasePublicEnv = process.env,
): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  return url && key ? { url, key } : null;
}
