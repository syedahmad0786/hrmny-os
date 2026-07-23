"use client";

import { Button } from "@hrmny/ui";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function StaffLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      return;
    }
    setPending(true);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { hd: "hrmny.co", prompt: "select_account" },
      },
    });
    if (authError) {
      setError(authError.message);
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-sm uppercase tracking-wide text-muted">hrmny OS</p>
        <h1 className="font-display text-3xl font-semibold">Staff sign in</h1>
        <p className="mt-2 text-muted">
          Use your approved Creative Harmony Google Workspace account.
        </p>
      </div>
      <Button type="button" onClick={() => void signIn()} disabled={pending}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </Button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </main>
  );
}
