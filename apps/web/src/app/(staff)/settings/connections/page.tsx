"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { useState } from "react";

const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

export default function ConnectionsPage() {
  const utils = trpc.useUtils();
  const list = trpc.connections.list.useQuery();
  const saveKey = trpc.connections.saveApiKey.useMutation({
    onSuccess: () => void utils.connections.list.invalidate(),
  });
  const startOAuth = trpc.connections.startOAuth.useMutation();
  const disconnect = trpc.connections.disconnect.useMutation({
    onSuccess: () => void utils.connections.list.invalidate(),
  });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [redirect, setRedirect] = useState<string | null>(null);

  async function connectGoogleWorkspace() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    localStorage.setItem("hrmny-google-workspace-connect", "pending");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        scopes: GOOGLE_WORKSPACE_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
          hd: "hrmny.co",
        },
      },
    });
    if (error) {
      localStorage.removeItem("hrmny-google-workspace-connect");
      throw error;
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Connections</h1>
        <p className="mt-2 text-muted">
          Connect, replace, or remove tools here. API keys are encrypted in
          Supabase Vault and are never returned to the browser.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(list.data ?? []).map((item) => (
          <section
            key={item.toolkit}
            className="rounded-lg border border-sand bg-white/70 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg">{item.label}</h2>
                <p className="text-sm text-muted">
                  {item.authType === "api_key"
                    ? "API key"
                    : item.authType === "oauth"
                      ? "OAuth"
                      : "Manual"}{" "}
                  · {item.status}
                </p>
                <p className="mt-1 text-xs text-muted">{item.note}</p>
                {item.externalConnectionId ? (
                  <p className="mt-1 text-xs font-medium text-ink">
                    {item.externalConnectionId}
                  </p>
                ) : null}
              </div>
              {item.connectionAccountId ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate({ id: item.connectionAccountId! })
                  }
                >
                  Disconnect
                </Button>
              ) : null}
            </div>

            {item.authType === "api_key" ? (
              <div className="mt-4 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border border-sand bg-white px-3 py-2"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    item.hasSecret ? "Paste replacement key" : "Paste API key"
                  }
                  value={keys[item.toolkit] ?? ""}
                  onChange={(event) =>
                    setKeys((current) => ({
                      ...current,
                      [item.toolkit]: event.target.value,
                    }))
                  }
                />
                <Button
                  type="button"
                  disabled={!keys[item.toolkit]?.trim() || saveKey.isPending}
                  onClick={() => {
                    saveKey.mutate({
                      toolkit: item.toolkit as "apollo" | "hunter" | "bayzat",
                      apiKey: keys[item.toolkit]!,
                    });
                    setKeys((current) => ({ ...current, [item.toolkit]: "" }));
                  }}
                >
                  {item.hasSecret ? "Replace" : "Connect"}
                </Button>
              </div>
            ) : item.authType === "oauth" ? (
              <Button
                className="mt-4"
                type="button"
                variant="ghost"
                disabled={!item.ready || startOAuth.isPending}
                onClick={() => {
                  if (item.toolkit === "google_workspace") {
                    void connectGoogleWorkspace();
                    return;
                  }
                  void startOAuth
                    .mutateAsync({
                      toolkit: item.toolkit as "canva",
                    })
                    .then((result) => setRedirect(result.redirectUrl));
                }}
              >
                {item.ready ? "Connect with OAuth" : "Provider setup needed"}
              </Button>
            ) : (
              <p className="mt-4 text-sm text-muted">
                Outreach stays human-approved and is copied into LinkedIn
                manually.
              </p>
            )}
          </section>
        ))}
      </div>

      {redirect ? (
        <p className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
          Authorization ready:{" "}
          <a className="text-ochre underline" href={redirect}>
            open provider login
          </a>
        </p>
      ) : null}
      {saveKey.error || disconnect.error || startOAuth.error ? (
        <p className="text-sm text-red-700">
          {(saveKey.error ?? disconnect.error ?? startOAuth.error)?.message}
        </p>
      ) : null}
    </main>
  );
}
