"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import Link from "next/link";
import { useState } from "react";

const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

export default function ConnectionsPage() {
  const utils = trpc.useUtils();
  const list = trpc.connections.list.useQuery();
  const asanaStatus = trpc.connections.asanaStatus.useQuery(undefined, {
    retry: false,
  });
  const saveKey = trpc.connections.saveApiKey.useMutation({
    onSuccess: () => void utils.connections.list.invalidate(),
  });
  const startOAuth = trpc.connections.startOAuth.useMutation();
  const disconnect = trpc.connections.disconnect.useMutation({
    onSuccess: () => void utils.connections.list.invalidate(),
  });
  const [toolSearch, setToolSearch] = useState("");
  const [toolPage, setToolPage] = useState(1);
  const managedToolkits = trpc.connections.managedToolkits.useQuery(
    { search: toolSearch, page: toolPage, pageSize: 12 },
    { retry: false },
  );
  const managedAccounts = trpc.connections.managedAccounts.useQuery(undefined, {
    retry: false,
    refetchInterval: 3_000,
  });
  const authorizeManaged = trpc.connections.authorizeManaged.useMutation({
    onSuccess: (result) => {
      setRedirect(result.redirectUrl);
      void utils.connections.managedAccounts.invalidate();
    },
  });
  const disconnectManaged = trpc.connections.disconnectManaged.useMutation({
    onSuccess: () => void utils.connections.managedAccounts.invalidate(),
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
          Business credentials stay encrypted in Supabase Vault. Personal tools
          use Composio-hosted authorization and are never exposed to the browser.
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Direct business connections
        </p>
        <p className="mt-1 text-sm text-muted">
          Workspace and business API keys managed directly by hrmny OS.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {(list.data ?? []).map((item) => {
          const verifiedAsana =
            item.toolkit === "asana" && asanaStatus.data?.connected;
          const asanaUser = verifiedAsana ? asanaStatus.data?.user : null;
          return (
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
                        : item.authType === "managed"
                          ? "Managed connection"
                          : "Manual"}{" "}
                    · {verifiedAsana ? "connected" : item.status}
                  </p>
                  <p className="mt-1 text-xs text-muted">{item.note}</p>
                  {!item.allowed ? (
                    <p className="mt-1 text-xs font-semibold text-amber-800">
                      Blocked by the organization connected-app policy
                    </p>
                  ) : null}
                  {asanaUser ? (
                    <p className="mt-1 text-xs font-medium text-ink">
                      {asanaUser.email ?? asanaUser.name}
                    </p>
                  ) : item.externalConnectionId ? (
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
                    disabled={!item.allowed}
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
                    disabled={
                      !item.allowed ||
                      !keys[item.toolkit]?.trim() ||
                      saveKey.isPending
                    }
                    onClick={() => {
                      saveKey.mutate({
                        toolkit: item.toolkit as
                          "apollo" | "hunter" | "bayzat",
                        apiKey: keys[item.toolkit]!,
                      });
                      setKeys((current) => ({
                        ...current,
                        [item.toolkit]: "",
                      }));
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
                  disabled={
                    !item.allowed || !item.ready || startOAuth.isPending
                  }
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
              ) : item.toolkit === "asana" && item.allowed ? (
                <div className="mt-4 flex items-center gap-3">
                  <Link
                    className="rounded border border-sand px-3 py-2 text-sm font-medium hover:bg-cream"
                    href="/settings/asana-migration"
                  >
                    Verify & scan
                  </Link>
                  {asanaStatus.isFetching ? (
                    <span className="text-xs text-muted">Checking…</span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  Outreach stays human-approved and is copied into LinkedIn
                  manually.
                </p>
              )}
            </section>
          );
        })}
      </div>

      <section className="rounded-xl border border-sand bg-white/70 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
              Personal tools via Composio
            </p>
            <h2 className="mt-1 font-display text-2xl text-ink">
              Connect your own apps
            </h2>
            <p className="mt-1 text-sm text-muted">
              Connect, verify, or disconnect only. hrmny OS will not read or act in
              these tools from this screen.
            </p>
          </div>
          <input
            className="w-full rounded border border-sand bg-white px-3 py-2 text-sm sm:w-72"
            type="search"
            placeholder="Search tools"
            value={toolSearch}
            onChange={(event) => {
              setToolSearch(event.target.value);
              setToolPage(1);
            }}
          />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(managedToolkits.data?.items ?? []).map((toolkit) => {
            const account = managedAccounts.data?.find(
              (candidate) => candidate.toolkit === toolkit.slug,
            );
            return (
              <div key={toolkit.slug} className="rounded-lg border border-sand p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-ink">{toolkit.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {toolkit.description ?? toolkit.slug}
                    </p>
                  </div>
                  <span className="rounded-full bg-cream px-2 py-1 text-[10px] font-semibold uppercase text-muted">
                    {account?.status.toLowerCase() ?? "available"}
                  </span>
                </div>
                {account ? (
                  <Button
                    className="mt-4"
                    type="button"
                    variant="ghost"
                    disabled={disconnectManaged.isPending}
                    onClick={() =>
                      disconnectManaged.mutate({ id: account.connectionAccountId })
                    }
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    className="mt-4"
                    type="button"
                    variant="ghost"
                    disabled={!toolkit.allowed || authorizeManaged.isPending}
                    onClick={() =>
                      authorizeManaged.mutate({ toolkit: toolkit.slug })
                    }
                  >
                    Connect
                  </Button>
                )}
                {!toolkit.allowed ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Blocked by the organization connected-app policy
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {managedToolkits.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading available tools…</p>
        ) : managedToolkits.data?.items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No managed tools match that search.</p>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3 text-sm">
          <Button
            type="button"
            variant="ghost"
            disabled={toolPage <= 1}
            onClick={() => setToolPage((current) => current - 1)}
          >
            Previous
          </Button>
          <span className="text-muted">
            Page {managedToolkits.data?.page ?? toolPage} of {managedToolkits.data?.pageCount ?? 1}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={toolPage >= (managedToolkits.data?.pageCount ?? 1)}
            onClick={() => setToolPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </section>

      {redirect ? (
        <p className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
          Authorization ready:{" "}
          <a className="text-ochre underline" href={redirect}>
            open provider login
          </a>
        </p>
      ) : null}
      {saveKey.error ||
      disconnect.error ||
      startOAuth.error ||
      asanaStatus.error ||
      managedToolkits.error ||
      managedAccounts.error ||
      authorizeManaged.error ||
      disconnectManaged.error ? (
        <p className="text-sm text-red-700">
          {
            (
              saveKey.error ??
              disconnect.error ??
              startOAuth.error ??
              asanaStatus.error ??
              managedToolkits.error ??
              managedAccounts.error ??
              authorizeManaged.error ??
              disconnectManaged.error
            )?.message
          }
        </p>
      ) : null}
    </main>
  );
}
