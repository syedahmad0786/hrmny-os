"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [verified, setVerified] = useState<unknown>(null);
  const magic = trpc.portal.auth.magicLink.useMutation();
  const verify = trpc.portal.auth.verify.useMutation();
  const devUsers = trpc.auth.devUsers.useQuery();

  async function requestLink() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/portal` },
      });
      setVerified(
        error
          ? { ok: false, reason: error.message }
          : {
              ok: true,
              message: "Check your email for the secure sign-in link.",
            },
      );
      return;
    }
    const result = await magic.mutateAsync({ email });
    setToken(result.stubToken ?? null);
    setVerified(null);
  }

  async function consume() {
    if (!token) return;
    const result = await verify.mutateAsync({ token });
    setVerified(result);
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <p className="text-sm uppercase tracking-wide text-muted">Client portal</p>
        <h1 className="font-display text-3xl font-semibold">Magic link</h1>
        <p className="mt-2 text-muted">
          Enter an approved client email to receive a secure sign-in link.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          className="rounded border border-sand bg-white px-3 py-2"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <Button
        type="button"
        onClick={() => void requestLink()}
        disabled={magic.isPending || !email.trim()}
      >
        Send magic link
      </Button>
      {token ? (
        <div className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
          <p className="text-muted">Stub token (dev only)</p>
          <code className="mt-1 block break-all">{token}</code>
          <Button
            className="mt-3"
            type="button"
            onClick={() => void consume()}
            disabled={verify.isPending}
          >
            Verify token
          </Button>
        </div>
      ) : null}
      {verified ? (
        <pre className="overflow-x-auto rounded-lg border border-sand bg-white/70 p-4 text-sm">
          {JSON.stringify(verified, null, 2)}
        </pre>
      ) : null}
      {(devUsers.data ?? []).some((user) => user.actorType === "portal") ? (
        <Link href="/portal" className="text-sm underline">
          Continue to portal (dev persona)
        </Link>
      ) : null}
    </main>
  );
}
