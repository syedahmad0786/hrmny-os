type SupabasePublicEnv = Readonly<Record<string, string | undefined>>;

export function getSupabasePublicConfig(
  env: SupabasePublicEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  return url && key ? { url, key } : null;
}
