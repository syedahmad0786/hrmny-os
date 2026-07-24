"use client";

import { Button } from "@hrmny/ui";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function StaffLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ssoEmail, setSsoEmail] = useState("");

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

  async function signInWithSso() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      return;
    }
    const domain = ssoEmail.trim().toLowerCase().split("@")[1];
    if (!domain) {
      setError("Enter your company email address.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithSSO({
      domain,
      options: { redirectTo: window.location.origin },
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
      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
        <span className="h-px flex-1 bg-sand" /> or{" "}
        <span className="h-px flex-1 bg-sand" />
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void signInWithSso();
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block font-medium">Company SSO email</span>
          <input
            className="w-full rounded-lg border border-sand bg-white px-3 py-2"
            type="email"
            value={ssoEmail}
            onChange={(event) => setSsoEmail(event.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
          />
        </label>
        <Button type="submit" variant="ghost" disabled={pending}>
          Continue with company SSO
        </Button>
      </form>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </main>
  );
}
