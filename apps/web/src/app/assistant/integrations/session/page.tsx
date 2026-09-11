"use client";

import type { Session } from "@supabase/supabase-js";
import { Button } from "@hrmny/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type SessionState =
  "waiting" | "checking" | "login" | "mismatch" | "return" | "done";

export default function NativeIntegrationsSessionPage() {
  const [nonce, setNonce] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [state, setState] = useState<SessionState>("waiting");
  const [error, setError] = useState<string | null>(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    const value =
      new URLSearchParams(window.location.search).get("nonce") ??
      sessionStorage.getItem("hrmny-integrations-active-nonce");
    const stored = value
      ? sessionStorage.getItem(`hrmny-integrations-proof:${value}`)
      : null;
    if (!value || !NONCE_PATTERN.test(value) || (!window.opener && !stored)) {
      setState("mismatch");
      setError("This secure session window was not opened by Integrations.");
      return;
    }
    setNonce(value);
    if (stored) setProof(stored);
  }, []);

  useEffect(() => {
    if (!nonce || proof || !window.opener) return;
    const opener = window.opener;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== opener)
        return;
      const data = event.data as {
        type?: unknown;
        nonce?: unknown;
        proof?: unknown;
      } | null;
      if (
        data?.type !== "hrmny-integrations-session-proof" ||
        data.nonce !== nonce ||
        typeof data.proof !== "string"
      )
        return;
      sessionStorage.setItem(`hrmny-integrations-proof:${nonce}`, data.proof);
      sessionStorage.setItem("hrmny-integrations-active-nonce", nonce);
      setProof(data.proof);
    };
    window.addEventListener("message", receive);
    const requestProof = () =>
      opener.postMessage(
        { type: "hrmny-integrations-session-request", nonce },
        window.location.origin,
      );
    requestProof();
    const retry = window.setInterval(requestProof, 500);
    const timeout = window.setTimeout(() => {
      window.clearInterval(retry);
      setState("mismatch");
      setError("The Integrations window did not confirm this request.");
    }, 10_000);
    return () => {
      window.removeEventListener("message", receive);
      window.clearInterval(retry);
      window.clearTimeout(timeout);
    };
  }, [nonce, proof]);

  const finish = useCallback(
    async (session: Session) => {
      if (!nonce || !proof || checkingRef.current) return;
      checkingRef.current = true;
      setState("checking");
      setError(null);
      try {
        const response = await fetch("/api/native-integrations/session", {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ proof, nonce }),
        });
        if (!response.ok) {
          setState("mismatch");
          setError(
            "Choose the same @hrmny.co Google Workspace account used in the native assistant.",
          );
          return;
        }
        if (window.opener) {
          window.opener.postMessage(
            {
              type: "hrmny-integrations-session",
              nonce,
              accessToken: session.access_token,
              refreshToken: session.refresh_token,
            },
            window.location.origin,
          );
          sessionStorage.removeItem(`hrmny-integrations-proof:${nonce}`);
          sessionStorage.removeItem("hrmny-integrations-active-nonce");
          setState("done");
          window.setTimeout(() => window.close(), 150);
        } else {
          setState("return");
          setError(null);
        }
      } catch {
        setState("login");
        setError("hrmny OS could not confirm this session. Try again.");
      } finally {
        checkingRef.current = false;
      }
    },
    [nonce, proof],
  );

  useEffect(() => {
    if (!proof) return;
    const client = getSupabaseBrowserClient();
    if (!client) {
      setState("mismatch");
      setError("hrmny OS authentication is not configured.");
      return;
    }
    let active = true;
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => {
        if (active && session) void finish(session);
      },
    );
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) void finish(data.session);
      else setState("login");
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [finish, proof]);

  async function signIn() {
    const client = getSupabaseBrowserClient();
    if (!client || !nonce || !proof) return;
    setState("checking");
    setError(null);
    sessionStorage.setItem("hrmny-integrations-active-nonce", nonce);
    const redirectTo = `${window.location.origin}/assistant/integrations/session`;
    const { error: authError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { hd: "hrmny.co", prompt: "select_account" },
      },
    });
    if (authError) {
      setState("login");
      setError(authError.message);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6">
      <p className="text-sm uppercase tracking-wide text-muted">hrmny OS</p>
      <h1 className="font-display text-3xl font-semibold">
        Confirm staff session
      </h1>
      <p className="text-muted">
        Sign in with the same @hrmny.co Google Workspace account used in the
        native assistant.
      </p>
      {(state === "login" || state === "mismatch") && nonce && proof ? (
        <Button type="button" onClick={() => void signIn()}>
          Continue with Google
        </Button>
      ) : null}
      {state === "waiting" || state === "checking" ? (
        <p className="text-sm text-muted">Checking access…</p>
      ) : null}
      {state === "done" ? (
        <p className="text-sm text-emerald-700">
          Confirmed. Returning to Integrations…
        </p>
      ) : null}
      {state === "return" ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Signed in. Return to hrmny and press Continue securely again.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </main>
  );
}
