"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { sanitizePortalNextPath } from "@/lib/portal-next";
import { setPortalGrant, trpc } from "@/lib/trpc";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type State = "verifying" | "success" | "invalid" | "error";

function VerifyInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const nextPath = sanitizePortalNextPath(params.get("next")) ?? "/portal";
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState<string | null>(null);
  const verify = trpc.portal.auth.verify.useMutation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setState("verifying");
    setMessage(null);
    try {
      if (token) {
        const result = await verify.mutateAsync({ token });
        if (result.ok) {
          if ("sessionGrant" in result && result.sessionGrant) {
            setPortalGrant(result.sessionGrant);
          }
          setState("success");
          setTimeout(() => router.push(nextPath), 800);
        } else {
          setState("invalid");
          setMessage(result.reason);
        }
        return;
      }
      // Supabase email-link path: the browser client finalizes the session from
      // the URL on load; confirm a session exists, then enter the portal.
      const supabase = getSupabaseBrowserClient();
      const session = (await supabase?.auth.getSession())?.data.session ?? null;
      if (session) {
        setState("success");
        setTimeout(() => router.push(nextPath), 800);
      } else {
        setState("invalid");
        setMessage("This sign-in link is invalid or has expired.");
      }
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Verification failed.");
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6 px-4">
      <div>
        <p className="text-sm uppercase tracking-wide text-muted">
          Client portal
        </p>
        <h1 className="font-display text-3xl font-semibold">
          {state === "success" ? "You're in" : "Verifying your link"}
        </h1>
      </div>

      {state === "verifying" ? (
        <p className="text-muted">Checking your sign-in link…</p>
      ) : null}

      {state === "success" ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted">Signed in. Taking you to the portal…</p>
          <Link href={nextPath} className="text-sm underline">
            Continue now
          </Link>
        </div>
      ) : null}

      {state === "invalid" || state === "error" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-sand bg-white/70 p-4">
            <p className="font-medium">Link didn&apos;t work</p>
            <p className="mt-1 text-sm text-muted">
              {message ?? "This sign-in link is invalid or has expired."}
            </p>
          </div>
          <Button type="button" onClick={() => router.push("/portal/login")}>
            Request a new link
          </Button>
        </div>
      ) : null}
    </main>
  );
}

export default function PortalVerifyPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md px-4 py-16 text-muted">Loading…</main>
      }
    >
      <VerifyInner />
    </Suspense>
  );
}
