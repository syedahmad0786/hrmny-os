"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Status = "idle" | "loading" | "sent" | "error";

export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);

  const config = trpc.portal.auth.config.useQuery();
  const magic = trpc.portal.auth.magicLink.useMutation();
  const devUsers = trpc.auth.devUsers.useQuery();

  const magicLinkEnabled = config.data?.magicLinkEnabled ?? false;

  async function requestLink() {
    setStatus("loading");
    setMessage(null);
    setDevToken(null);
    try {
      // Flag on: enumeration-safe server path. The server decides whether the
      // email is invited; the response is identical either way.
      if (magicLinkEnabled) {
        await magic.mutateAsync({
          email,
          redirectTo: `${window.location.origin}/portal/login/verify`,
        });
        setStatus("sent");
        return;
      }

      // Flag off: preserve existing behavior exactly.
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/portal` },
        });
        if (error) {
          setStatus("error");
          setMessage(error.message);
        } else {
          setStatus("sent");
        }
        return;
      }
      const result = await magic.mutateAsync({ email });
      setDevToken(result.stubToken ?? null);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <p className="text-sm uppercase tracking-wide text-muted">
          Client portal
        </p>
        <h1 className="font-display text-3xl font-semibold">Sign in</h1>
        <p className="mt-2 text-muted">
          Enter your invited email to receive a secure sign-in link.
        </p>
      </div>

      {status === "sent" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-sand bg-white/70 p-4">
            <p className="font-medium">Check your email</p>
            <p className="mt-1 text-sm text-muted">
              If {email || "your address"} is an invited portal contact, a
              sign-in link is on its way. The link expires in 15 minutes.
            </p>
          </div>
          {devToken ? (
            <div className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
              <p className="text-muted">Stub token (dev only)</p>
              <code className="mt-1 block break-all">{devToken}</code>
              <Link
                href={`/portal/login/verify?token=${encodeURIComponent(devToken)}`}
                className="mt-3 inline-block underline"
              >
                Open verify link
              </Link>
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStatus("idle");
              setMessage(null);
              setDevToken(null);
            }}
          >
            Use a different email
          </Button>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              className="rounded border border-sand bg-white px-3 py-2"
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <Button
            type="button"
            onClick={() => void requestLink()}
            disabled={status === "loading" || !email.trim()}
          >
            {status === "loading" ? "Sending…" : "Send magic link"}
          </Button>
          {status === "error" && message ? (
            <p className="text-sm text-red-700">{message}</p>
          ) : null}
        </>
      )}

      {(devUsers.data ?? []).some((user) => user.actorType === "portal") ? (
        <Link href="/portal" className="text-sm underline">
          Continue to portal (dev persona)
        </Link>
      ) : null}
    </main>
  );
}
