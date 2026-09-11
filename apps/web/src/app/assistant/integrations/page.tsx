"use client";

import { Button } from "@hrmny/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionsPageContent } from "@/app/(staff)/settings/connections/connections-page-content";
import { Providers } from "@/components/providers";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

const NATIVE_ORIGIN = "https://hrmny-portal.fly.dev";
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type BridgeState = "waiting" | "checking" | "login" | "ready" | "denied";

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function verifySession(
  accessToken: string,
  proof: string,
  nonce: string,
): Promise<boolean> {
  try {
    const response = await fetch("/api/native-integrations/session", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ proof, nonce }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function StaffIntegrations() {
  const session = trpc.auth.session.useQuery();
  if (session.isLoading)
    return <main className="p-6 text-sm text-muted">Checking access…</main>;
  if (!session.data?.employeeId || session.data.actorType !== "staff")
    return (
      <main className="p-6 text-sm text-muted">
        Your authenticated OS account is not an active staff account.
      </main>
    );
  return <ConnectionsPageContent embedded />;
}

function NativeIntegrationsGate() {
  const [nonce, setNonce] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [state, setState] = useState<BridgeState>("waiting");
  const [message, setMessage] = useState("Confirming your native identity…");
  const popupRef = useRef<Window | null>(null);

  useEffect(() => setNonce(randomNonce()), []);

  const acceptSession = useCallback(
    async (accessToken: string, refreshToken: string, currentProof: string) => {
      if (!nonce || !NONCE_PATTERN.test(nonce)) return;
      setState("checking");
      setMessage("Confirming the same staff identity in hrmny OS…");
      const client = getSupabaseBrowserClient();
      if (!client) {
        setState("denied");
        setMessage("hrmny OS authentication is not configured.");
        return;
      }
      if (!(await verifySession(accessToken, currentProof, nonce))) {
        setState("login");
        setMessage(
          "The native assistant and hrmny OS are signed in as different Google Workspace users. Continue securely to choose the matching account.",
        );
        return;
      }
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error || !data.session) {
        setState("login");
        setMessage(
          "hrmny OS could not install the confirmed session. Try again.",
        );
        return;
      }
      setState("ready");
      setMessage("");
    },
    [nonce],
  );

  useEffect(() => {
    if (!nonce) return;
    const source = window.parent !== window ? window.parent : window.opener;
    if (!source) {
      setState("denied");
      setMessage("Open Integrations from the hrmny AI Assistant.");
      return;
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== NATIVE_ORIGIN || event.source !== source) return;
      const data = event.data as {
        type?: unknown;
        nonce?: unknown;
        proof?: unknown;
      } | null;
      if (data?.nonce !== nonce) return;
      if (
        data.type === "hrmny-integrations-proof" &&
        typeof data.proof === "string"
      ) {
        setProof(data.proof);
        return;
      }
      if (data.type === "hrmny-integrations-proof-error") {
        setState("denied");
        setMessage(
          "Native identity verification is unavailable. Try again shortly.",
        );
      }
    };
    window.addEventListener("message", receive);
    source.postMessage(
      { type: "hrmny-integrations-challenge", nonce },
      NATIVE_ORIGIN,
    );
    const timeout = window.setTimeout(() => {
      setState((current) => {
        if (current !== "waiting") return current;
        setMessage(
          "Native identity verification timed out. Close and reopen Integrations.",
        );
        return "denied";
      });
    }, 15_000);
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timeout);
    };
  }, [nonce]);

  useEffect(() => {
    if (!nonce || !proof) return;
    let active = true;
    void getSupabaseBrowserClient()
      ?.auth.getSession()
      .then(async ({ data }) => {
        if (!active) return;
        const session = data.session;
        if (
          session &&
          (await verifySession(session.access_token, proof, nonce))
        ) {
          setState("ready");
          setMessage("");
          return;
        }
        setState("login");
        setMessage(
          "Continue in a secure hrmny OS window to confirm your staff session.",
        );
      })
      .catch(() => {
        if (!active) return;
        setState("login");
        setMessage(
          "Continue in a secure hrmny OS window to confirm your staff session.",
        );
      });
    return () => {
      active = false;
    };
  }, [nonce, proof]);

  useEffect(() => {
    if (!nonce || !proof) return;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popupRef.current
      )
        return;
      const data = event.data as {
        type?: unknown;
        nonce?: unknown;
        accessToken?: unknown;
        refreshToken?: unknown;
      } | null;
      if (data?.nonce !== nonce) return;
      if (data.type === "hrmny-integrations-session-request") {
        popupRef.current?.postMessage(
          { type: "hrmny-integrations-session-proof", nonce, proof },
          window.location.origin,
        );
        return;
      }
      if (
        data.type === "hrmny-integrations-session" &&
        typeof data.accessToken === "string" &&
        typeof data.refreshToken === "string"
      )
        void acceptSession(data.accessToken, data.refreshToken, proof);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [acceptSession, nonce, proof]);

  function openSessionWindow() {
    if (!nonce || !proof) return;
    const popup = window.open(
      `/assistant/integrations/session?nonce=${encodeURIComponent(nonce)}`,
      `hrmny-integrations-session-${nonce.slice(0, 8)}`,
      "popup,width=520,height=720",
    );
    if (!popup) {
      setState("login");
      setMessage("Allow pop-ups for hrmny OS, then try again.");
      return;
    }
    popupRef.current = popup;
  }

  if (state === "ready")
    return (
      <Providers>
        <StaffIntegrations />
      </Providers>
    );

  return (
    <main className="mx-auto flex min-h-[420px] max-w-md flex-col justify-center gap-4 p-6">
      <p className="text-sm uppercase tracking-wide text-muted">hrmny OS</p>
      <h1 className="font-display text-2xl font-semibold">Integrations</h1>
      <p className="text-sm text-muted">{message}</p>
      {state === "login" ? (
        <Button type="button" onClick={openSessionWindow}>
          Continue securely
        </Button>
      ) : null}
    </main>
  );
}

export default function AssistantIntegrationsPage() {
  return <NativeIntegrationsGate />;
}
