"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConnectionHealth } from "./connection-health";

const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

const WORK_APP_FAMILIES = [
  { key: "files", label: "Cloud files" },
  { key: "communication", label: "Communication" },
  { key: "enterprise", label: "Enterprise workflows" },
] as const;

export default function ConnectionsPage() {
  const utils = trpc.useUtils();
  const list = trpc.connections.list.useQuery();
  const asanaStatus = trpc.connections.asanaStatus.useQuery(undefined, {
    retry: false,
  });
  const workApps = trpc.connections.workApps.useQuery(undefined, {
    retry: false,
  });
  const saveKey = trpc.connections.saveApiKey.useMutation({
    onSuccess: () =>
      void Promise.all([
        utils.connections.list.invalidate(),
        utils.connections.workApps.invalidate(),
        utils.connections.asanaStatus.invalidate(),
      ]),
  });
  const startXeroOAuth = trpc.connections.startXeroOAuth.useMutation();
  const startOAuth = trpc.connections.startOAuth.useMutation();
  const probeGoogle = trpc.connections.probeGoogleWorkspace.useMutation({
    onSuccess: () =>
      void Promise.all([
        utils.connections.list.invalidate(),
        utils.connections.workApps.invalidate(),
      ]),
  });
  const disconnect = trpc.connections.disconnect.useMutation({
    onSuccess: () =>
      void Promise.all([
        utils.connections.list.invalidate(),
        utils.connections.workApps.invalidate(),
        utils.connections.asanaStatus.invalidate(),
      ]),
  });
  const startWorkApp = trpc.connections.startWorkAppLink.useMutation({
    onSuccess: (result) => window.location.assign(result.redirectUrl),
  });
  const disconnectWorkApp = trpc.connections.disconnectWorkApp.useMutation({
    onSuccess: () => void utils.connections.workApps.invalidate(),
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
  const [demoBlockers, setDemoBlockers] = useState<string[]>([]);
  const autoProbedGw = useRef(false);

  useEffect(() => {
    if (autoProbedGw.current || !list.data) return;
    const gw = list.data.find((row) => row.toolkit === "google_workspace");
    if (!gw) return;
    if (gw.status !== "error" && !gw.lastError) return;
    autoProbedGw.current = true;
    void probeGoogle.mutateAsync().catch(() => undefined);
    // One-shot heal attempt when Connections first sees a GW error row.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [list.data]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ready")
      .then((r) => r.json())
      .then(
        (body: {
          tools?: Record<string, string>;
          connections?: {
            googleWorkspace?: number;
            canva?: number;
            linkedin?: number;
            xero?: number;
            errors?: {
              googleWorkspace?: number;
              canva?: number;
              linkedin?: number;
              xero?: number;
            };
          };
        }) => {
          if (cancelled) return;
          const tools = body.tools ?? {};
          const connections = body.connections ?? {};
          const next: string[] = [];
          if (tools.apollo === "mock") {
            next.push("Paste an Apollo API key below (or in Vercel env).");
          }
          if (tools.hunter === "mock") {
            next.push("Paste a Hunter API key below (or in Vercel env).");
          }
          if (tools.xero === "mock" || (connections.xero ?? 0) < 1) {
            next.push("Connect Xero via OAuth for live billing mirror.");
          }
          if ((connections.googleWorkspace ?? 0) < 1) {
            next.push(
              (connections.errors?.googleWorkspace ?? 0) > 0
                ? "Reconnect Google Workspace (@hrmny.co) — token revoked; click Reconnect below (tokens are captured immediately after OAuth)."
                : "Connect Google Workspace (@hrmny.co) for live HITL Gmail send.",
            );
          }
          if ((connections.linkedin ?? 0) < 1) {
            next.push(
              "Connect LinkedIn with Composio for live campaign publish.",
            );
          }
          if ((connections.canva ?? 0) < 1) {
            next.push("Connect Canva with Composio for design → portal.");
          }
          if (tools.resend && tools.resend !== "live") {
            next.push(
              tools.resend === "configured"
                ? "Resend API key is set — flip RESEND_MODE=live and set RESEND_FROM for real portal invite email."
                : "Set RESEND_MODE=live + RESEND_API_KEY + RESEND_FROM for real portal invite email.",
            );
          }
          setDemoBlockers(next);
        },
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [list.dataUpdatedAt]);

  async function connectGoogleWorkspace() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    localStorage.setItem("hrmny-google-workspace-connect", "pending");
    try {
      sessionStorage.removeItem("hrmny-gw-oauth-tokens");
    } catch {
      /* ignore */
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/settings/connections`,
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
          use Composio-hosted authorization and are never exposed to the
          browser.{" "}
          <Link href="/settings/automations" className="underline">
            Automations / n8n smoke
          </Link>
          .
        </p>
      </div>

      <ConnectionHealth />

      {demoBlockers.length > 0 ? (
        <section className="rounded-lg border border-ochre/40 bg-cream/50 p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
            Live demo blockers
          </p>
          <p className="mt-1 text-muted">
            Close these gaps so prospecting → sales → creative → portal can run
            live on production.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-ink">
            {demoBlockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Also see{" "}
            <Link href="/crm/hunt" className="underline">
              Hunt readiness
            </Link>
            .
          </p>
        </section>
      ) : null}

      <div id="direct-business-connections">
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
                  {item.lastError ? (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      {item.lastError}
                    </p>
                  ) : null}
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
                      item.hasSecret
                        ? "Paste replacement key (live-probed)"
                        : "Paste API key (live-probed on save)"
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
                          | "apollo"
                          | "hunter"
                          | "bayzat"
                          | "n8n",
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={
                      !item.allowed ||
                      !item.ready ||
                      startOAuth.isPending ||
                      startXeroOAuth.isPending ||
                      authorizeManaged.isPending
                    }
                    onClick={() => {
                      if (item.toolkit === "google_workspace") {
                        void connectGoogleWorkspace();
                        return;
                      }
                      if (item.toolkit === "xero") {
                        void startXeroOAuth
                          .mutateAsync()
                          .then((result) => setRedirect(result.redirectUrl));
                        return;
                      }
                      if (
                        item.toolkit === "canva" ||
                        item.toolkit === "linkedin"
                      ) {
                        void authorizeManaged
                          .mutateAsync({ toolkit: item.toolkit })
                          .then((result) => setRedirect(result.redirectUrl));
                      }
                    }}
                  >
                    {item.ready
                      ? item.toolkit === "canva" || item.toolkit === "linkedin"
                        ? item.status === "connected"
                          ? "Reconnect with Composio"
                          : "Connect with Composio"
                        : item.status === "error" || item.lastError
                          ? "Reconnect (token revoked)"
                          : item.status === "connected"
                            ? "Reconnect with OAuth"
                            : "Connect with OAuth"
                      : "Provider setup needed"}
                  </Button>
                  {item.toolkit === "google_workspace" &&
                  item.ready &&
                  (item.status === "error" ||
                    item.status === "connected" ||
                    item.lastError) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={probeGoogle.isPending}
                      onClick={() => void probeGoogle.mutateAsync()}
                    >
                      {probeGoogle.isPending
                        ? "Testing…"
                        : "Test / heal token"}
                    </Button>
                  ) : null}
                  {probeGoogle.data && item.toolkit === "google_workspace" ? (
                    <p
                      className={`w-full text-xs ${
                        probeGoogle.data.ok ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {probeGoogle.data.ok
                        ? `OK · ${probeGoogle.data.status}${
                            probeGoogle.data.account
                              ? ` · ${probeGoogle.data.account}`
                              : ""
                          }`
                        : `Failed · ${
                            "reason" in probeGoogle.data
                              ? probeGoogle.data.reason
                              : "unknown"
                          }`}
                    </p>
                  ) : null}
                </div>
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
              Connect, verify, or disconnect only. hrmny OS will not read or act
              in these tools from this screen.
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
              <div
                key={toolkit.slug}
                className="rounded-lg border border-sand p-4"
              >
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!toolkit.allowed || authorizeManaged.isPending}
                    onClick={() =>
                      authorizeManaged.mutate({ toolkit: toolkit.slug })
                    }
                  >
                    {account ? "Reconnect" : "Connect"}
                  </Button>
                  {account ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disconnectManaged.isPending}
                      onClick={() =>
                        disconnectManaged.mutate({
                          id: account.connectionAccountId,
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
                {!toolkit.allowed ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Blocked by the organization connected-app policy
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    Each teammate connects their own Composio account.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {managedToolkits.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading available tools…</p>
        ) : managedToolkits.data?.items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No managed tools match that search.
          </p>
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
            Page {managedToolkits.data?.page ?? toolPage} of{" "}
            {managedToolkits.data?.pageCount ?? 1}
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

      {workApps.data?.apps.length ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold">
              Work app integrations
            </h2>
            <p className="mt-1 text-sm text-muted">
              These groups are independently controlled by Feature Lab. A
              provider is connectable only after its auth config exists in the
              connected Composio project.
            </p>
          </div>

          {!workApps.data.bridgeAllowed ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Composio is blocked by the organization connected-app policy.
            </p>
          ) : !workApps.data.bridgeConfigured ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Connect the Composio project above to discover live provider
              accounts and auth configurations.
            </p>
          ) : workApps.data.bridgeError ? (
            <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              Composio could not be checked: {workApps.data.bridgeError}
            </p>
          ) : null}

          {WORK_APP_FAMILIES.map((family) => {
            const apps = workApps.data.apps.filter(
              (item) => item.family === family.key,
            );
            if (!apps.length) return null;
            return (
              <div key={family.key}>
                <h3 className="mb-2 font-display text-lg">{family.label}</h3>
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {apps.map((item) => (
                    <article
                      key={item.toolkit}
                      className="rounded-lg border border-sand bg-white/70 p-4"
                    >
                      <div className="flex min-h-24 flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="font-display text-base">
                              {item.label}
                            </h4>
                            <p className="text-xs font-medium text-muted">
                              {item.connected
                                ? "Connected"
                                : !workApps.data.bridgeConfigured ||
                                    workApps.data.bridgeError
                                  ? "Not checked"
                                  : item.connectionStatus
                                    ? item.connectionStatus.toLowerCase()
                                    : item.authConfigured
                                      ? "Ready to connect"
                                      : "Auth config needed"}
                              {item.managedAuth === true
                                ? " · managed auth"
                                : item.managedAuth === false
                                  ? " · custom auth"
                                  : ""}
                            </p>
                          </div>
                          <span
                            className={`mt-1 size-2.5 rounded-full ${item.connected ? "bg-green-600" : "bg-sand"}`}
                            aria-label={
                              item.connected ? "Connected" : "Not connected"
                            }
                          />
                        </div>
                        <p className="mt-2 flex-1 text-xs text-muted">
                          {item.note}
                        </p>
                      </div>
                      {!item.allowed ? (
                        <p className="mt-2 text-xs font-semibold text-amber-800">
                          Blocked by the connected-app policy
                        </p>
                      ) : null}
                      {item.connectedAccountId ? (
                        <Button
                          className="mt-3"
                          type="button"
                          variant="ghost"
                          disabled={disconnectWorkApp.isPending}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Disconnect ${item.label} and revoke its provider credentials?`,
                              )
                            )
                              return;
                            disconnectWorkApp.mutate({
                              toolkit: item.toolkit,
                              connectedAccountId: item.connectedAccountId!,
                            });
                          }}
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          className="mt-3"
                          type="button"
                          variant="ghost"
                          disabled={
                            !item.allowed ||
                            !item.authConfigured ||
                            !workApps.data.bridgeConfigured ||
                            Boolean(workApps.data.bridgeError) ||
                            startWorkApp.isPending
                          }
                          onClick={() =>
                            startWorkApp.mutate({ toolkit: item.toolkit })
                          }
                        >
                          {item.authConfigured
                            ? "Connect"
                            : item.authConfigured === false
                              ? "Configure in Composio"
                              : "Connect Composio first"}
                        </Button>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

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
      disconnectManaged.error ||
      startWorkApp.error ||
      disconnectWorkApp.error ||
      workApps.error ? (
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
              disconnectManaged.error ??
              startWorkApp.error ??
              disconnectWorkApp.error ??
              workApps.error
            )?.message
          }
        </p>
      ) : null}
    </main>
  );
}
