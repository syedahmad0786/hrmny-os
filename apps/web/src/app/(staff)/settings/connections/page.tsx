"use client";

import { Button } from "@hrmny/ui";
import { isGoogleWorkspaceReconnectRequired } from "@/lib/google-workspace-error";
import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConnectionHealth } from "./connection-health";
import { PlatformReadyStrip } from "@/components/platform-ready-strip";

function AppPolicyBanner() {
  const utils = trpc.useUtils();
  const policy = trpc.connections.organizationPolicy.useQuery();
  const reopen = trpc.connections.reopenApprovedAppPolicy.useMutation({
    onSuccess: () =>
      void Promise.all([
        utils.connections.organizationPolicy.invalidate(),
        utils.connections.list.invalidate(),
        utils.connections.workApps.invalidate(),
      ]),
  });
  if (!policy.data) return null;
  const disabled = policy.data.appPolicy === "disabled";
  return (
    <section
      data-testid="connections-app-policy"
      className={`rounded-lg border p-4 text-sm ${
        disabled
          ? "border-amber-300 bg-amber-50 text-amber-950"
          : "border-sand bg-white/75 text-ink"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em]">
        Connected-app policy
      </p>
      <p className="mt-1">
        {disabled ? (
          <>
            Organization policy is still <strong>disabled</strong> in the
            database, so Work / Composio extras stay grey. First-party CRM cards
            (Google Workspace, Apollo) stay connectable.
          </>
        ) : (
          <>
            Organization policy is{" "}
            <strong>{policy.data.appPolicy.replaceAll("_", " ")}</strong>
            {policy.data.healed ? " (just reopened)" : ""}. First-party CRM apps
            are always allowed.
          </>
        )}
      </p>
      {disabled && policy.data.canReopen ? (
        <button
          type="button"
          data-testid="connections-reopen-app-policy"
          className="mt-3 rounded-lg bg-ink px-3 py-2 text-sm text-white"
          disabled={reopen.isPending}
          onClick={() => reopen.mutate()}
        >
          {reopen.isPending ? "Reopening…" : "Reopen approved apps now"}
        </button>
      ) : null}
      {disabled && !policy.data.canReopen ? (
        <p className="mt-2 text-xs font-medium">
          An HRMNY administrator must reopen the approved-app policy.
        </p>
      ) : null}
      {reopen.error ? (
        <p className="mt-2 text-sm text-red-700">{reopen.error.message}</p>
      ) : null}
    </section>
  );
}

function PolicyBlockedNote() {
  return (
    <p className="mt-1 text-xs font-semibold text-amber-800">
      This Work / Composio app is off the approved list. First-party CRM
      connections stay available.{" "}
      <Link href="/admin/work" className="underline">
        Admin → Work
      </Link>
    </p>
  );
}

function BackendStoreBanner() {
  const [ready, setReady] = useState<{
    database?: "up" | "down";
    keyStore?: "vault" | "memory";
    tools?: Record<string, string>;
    googleOAuthRedirectUri?: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ready")
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setReady(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!ready) return null;
  const vault = ready.database === "up" && ready.keyStore !== "memory";
  return (
    <section
      data-testid="connections-backend-store"
      className={`rounded-lg border p-4 text-sm ${
        vault
          ? "border-emerald-300 bg-emerald-50 text-emerald-950"
          : "border-amber-300 bg-amber-50 text-amber-950"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em]">
        Connection backend
      </p>
      {vault ? (
        <p className="mt-1">
          Keys and OAuth tokens save to Supabase Vault. Paste or replace Apollo
          here — a live probe runs first. Google Reconnect uses dedicated OAuth
          (not Heal). Hunter is retired and is not required.
        </p>
      ) : (
        <p className="mt-1">
          This process has no database. Pasted keys save in memory for this
          server instance so Connect is not a dead button. Use{" "}
          <a
            className="underline"
            href="https://hrmny-os.vercel.app/settings/connections"
          >
            production Connections
          </a>{" "}
          as an @hrmny.co staff seat for Vault persistence. Google OAuth client:{" "}
          {ready.tools?.googleOAuth ?? "—"}.
        </p>
      )}
      <p className="mt-2 text-xs" data-testid="conn-gw-redirect">
        Google callback this page sends:{" "}
        <code>
          {typeof window !== "undefined"
            ? `${window.location.origin}/api/integrations/google-workspace/callback`
            : (ready.googleOAuthRedirectUri ??
              "https://hrmny-os.vercel.app/api/integrations/google-workspace/callback")}
        </code>
      </p>
    </section>
  );
}

function OperatingSurfaces() {
  const appOrigin = (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://hrmny-os.vercel.app"
  ).replace(/\/$/, "");
  const googleChatUrl = `${appOrigin}/api/integrations/google-chat/events`;
  const qmUrl = process.env.NEXT_PUBLIC_QM_URL?.trim().replace(/\/$/, "");
  const [googleChatStatus, setGoogleChatStatus] = useState("checking");
  const [gbrainStatus, setGbrainStatus] = useState("checking");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ready")
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) {
          setGoogleChatStatus(
            body?.surfaces?.googleChat?.status ?? "endpoint_ready",
          );
          setGbrainStatus(body?.surfaces?.gbrain?.status ?? "setup_required");
        }
      })
      .catch(() => {
        if (!cancelled) setGoogleChatStatus("endpoint_ready");
        if (!cancelled) setGbrainStatus("setup_required");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const googleChatLive = googleChatStatus === "live";
  const googleChatConfigured = googleChatStatus === "async_configured";
  const gbrainLive = gbrainStatus === "live";
  const gbrainConfigured = gbrainStatus === "configured";

  return (
    <section
      data-testid="operating-surfaces"
      className="grid gap-4 xl:grid-cols-3"
    >
      <article
        className={`rounded-xl border p-5 ${
          googleChatLive
            ? "border-emerald-300 bg-emerald-50 text-emerald-950"
            : "border-amber-300 bg-amber-50 text-amber-950"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em]">
          Team chat ·{" "}
          {googleChatLive
            ? "live verified"
            : googleChatConfigured
              ? "credential present"
              : "setup required"}
        </p>
        <h2 className="mt-1 font-display text-xl">Google Chat → HRMNY</h2>
        <p className="mt-2 text-sm">
          {googleChatLive
            ? "Staff messages enter the same HRMNY assistant with durable, thread-specific replies. Google-signed requests and active staff are verified before anything runs."
            : googleChatConfigured
              ? "A service-account credential is present and the durable worker is built. Run one named-user message canary before treating Google Chat as live."
              : "The signed endpoint is built, but the Google Chat service account and named-user canary are still required before staff messages work."}
        </p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-white/70 p-3 text-xs">
          {googleChatUrl}
        </code>
        <Link
          href="/chat"
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white"
        >
          Open HRMNY Chat
        </Link>
      </article>

      <article
        className={`rounded-xl border p-5 ${
          gbrainLive
            ? "border-emerald-300 bg-emerald-50 text-emerald-950"
            : "border-amber-300 bg-amber-50 text-amber-950"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em]">
          Company brain ·{" "}
          {gbrainLive
            ? "live verified"
            : gbrainConfigured
              ? "credential present"
              : "setup required"}
        </p>
        <h2 className="mt-1 font-display text-xl">
          Published knowledge → GBrain
        </h2>
        <p className="mt-2 text-sm">
          {gbrainLive
            ? "A reviewed HRMNY article has crossed the scoped bridge and passed provider read-back. New versions still require their own approval."
            : gbrainConfigured
              ? "The scoped bridge is connected. Share one published article from Workplace to complete the live verification."
              : "Deploy the pinned GBrain service, then add its MCP URL, source-scoped token and source ID. Drafts and operational records never cross this bridge."}
        </p>
        <Link
          href="/workplace"
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white"
        >
          Open Knowledge Hub
        </Link>
      </article>

      <article className="rounded-xl border border-sand bg-white/75 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Agent computers · {qmUrl ? "connected" : "deployment ready"}
        </p>
        <h2 className="mt-1 font-display text-xl">QM + Fly Sprites</h2>
        <p className="mt-2 text-sm text-muted">
          One isolated operator environment per user. The version-pinned deploy
          package is ready; Fly must be billing-enabled before its apps and
          Sprites can be created.
        </p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-cream/70 p-3 text-xs">
          {qmUrl ?? "https://hrmny-qm-portal.fly.dev"}
        </code>
        {qmUrl ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={qmUrl}
              className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white"
            >
              Open QM
            </a>
            <a
              href={`${qmUrl}/admin/connectors`}
              className="inline-flex min-h-11 items-center rounded-lg border border-sand bg-white px-4 text-sm font-semibold"
            >
              Manage connectors
            </a>
          </div>
        ) : (
          <p className="mt-3 text-xs font-medium text-amber-800">
            No dead link is shown until the Fly deployment is live and
            NEXT_PUBLIC_QM_URL is set.
          </p>
        )}
      </article>
    </section>
  );
}

const WORK_APP_FAMILIES = [
  { key: "files", label: "Cloud files" },
  { key: "communication", label: "Communication" },
  { key: "enterprise", label: "Enterprise workflows" },
] as const;

export default function ConnectionsPage() {
  const utils = trpc.useUtils();
  const [personalToolsOpen, setPersonalToolsOpen] = useState(false);
  const list = trpc.connections.list.useQuery();
  const salesMailboxes = trpc.connections.salesMailboxes.useQuery();
  const [mailboxEdits, setMailboxEdits] = useState<
    Record<string, { label: string; dailyCap: number; enabled: boolean }>
  >({});
  const saveMailbox = trpc.connections.setSalesMailboxPolicy.useMutation({
    onSuccess: () => void utils.connections.salesMailboxes.invalidate(),
  });
  const asanaStatus = trpc.connections.asanaStatus.useQuery(undefined, {
    retry: false,
  });
  const workApps = trpc.connections.workApps.useQuery(undefined, {
    retry: false,
  });
  const saveKey = trpc.connections.saveApiKey.useMutation({
    onSuccess: (_data, vars) => {
      setKeys((current) => ({
        ...current,
        [vars.toolkit]: "",
      }));
      setKeyNotes((current) => ({
        ...current,
        [vars.toolkit]:
          vars.toolkit +
          ` connected · ${_data.store ?? "vault"}` +
          (_data.probed ? " · live-probed" : "") +
          (_data.probeWarning ? ` · probe warning: ${_data.probeWarning}` : ""),
      }));
      void Promise.all([
        utils.connections.list.invalidate(),
        utils.connections.workApps.invalidate(),
        utils.connections.asanaStatus.invalidate(),
      ]);
    },
  });
  const [keyNotes, setKeyNotes] = useState<Record<string, string>>({});
  const startXeroOAuth = trpc.connections.startXeroOAuth.useMutation();
  const startGoogleWorkspaceOAuth =
    trpc.connections.startGoogleWorkspaceOAuth.useMutation();
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
        utils.connections.salesMailboxes.invalidate(),
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
    { enabled: personalToolsOpen, retry: false },
  );
  const managedAccounts = trpc.connections.managedAccounts.useQuery(undefined, {
    enabled: personalToolsOpen,
    retry: false,
    refetchInterval: 3_000,
  });
  const authorizeManaged = trpc.connections.authorizeManaged.useMutation({
    onSuccess: (result) => {
      // Navigate immediately so Composio callback_url lands back here for reconcile.
      window.location.assign(result.redirectUrl);
    },
  });
  const disconnectManaged = trpc.connections.disconnectManaged.useMutation({
    onSuccess: () => void utils.connections.managedAccounts.invalidate(),
  });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [redirect, setRedirect] = useState<string | null>(null);
  const [oauthBanner, setOauthBanner] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gw = params.get("gw");
    const xero = params.get("xero");
    if (gw === "connected") {
      setOauthBanner({
        kind: "ok",
        text: `Google Workspace connected${
          params.get("account") ? `: ${params.get("account")}` : ""
        }. Mailbox send can go live after HITL approve.`,
      });
    } else if (gw === "error") {
      setOauthBanner({
        kind: "err",
        text: `Google Workspace connect failed: ${params.get("reason") ?? "unknown"}. Confirm the Google Cloud redirect URI is ${window.location.origin}/api/integrations/google-workspace/callback, then Reconnect.`,
      });
    } else if (xero === "connected") {
      setOauthBanner({
        kind: "ok",
        text: `Xero connected${
          params.get("tenant") ? ` · tenant ${params.get("tenant")}` : ""
        }.`,
      });
    } else if (xero === "error") {
      setOauthBanner({
        kind: "err",
        text: `Xero connect failed: ${params.get("reason") ?? "unknown"}`,
      });
    }
  }, []);

  useEffect(() => {
    if (list.isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const id =
      window.location.hash.slice(1) ||
      (params.get("gw") != null
        ? "conn-google_workspace"
        : params.get("xero") != null
          ? "conn-xero"
          : null);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [list.isLoading]);

  async function connectGoogleWorkspace() {
    const result = await startGoogleWorkspaceOAuth.mutateAsync({
      origin: window.location.origin,
    });
    window.location.assign(result.redirectUrl);
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Connections</h1>
        <p className="mt-2 text-muted">
          Connect, replace, or disconnect the accounts HRMNY uses. Each card
          shows whether the tool is ready and the next available action.
        </p>
      </div>

      <details className="rounded-xl border border-sand bg-white/70 px-4 py-3 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-ink">
          Connection diagnostics
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <PlatformReadyStrip testId="connections-platform-ready" />
          <BackendStoreBanner />
          <AppPolicyBanner />
          <ConnectionHealth />
          <Link
            href="/settings/automations"
            className="inline-flex min-h-11 w-fit items-center underline"
          >
            Automation settings
          </Link>
        </div>
      </details>

      <OperatingSurfaces />

      {oauthBanner ? (
        <p
          role="status"
          data-testid="connections-oauth-banner"
          className={`rounded-lg border p-4 text-sm ${
            oauthBanner.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {oauthBanner.text}
        </p>
      ) : null}

      <div id="direct-business-connections">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Business tools
        </p>
        <p className="mt-1 text-sm text-muted">
          Start with Apollo for prospecting and Google Workspace for approved
          email. Open another card only when that tool is part of your workflow.
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
              id={`conn-${item.toolkit}`}
              data-testid={`conn-card-${item.toolkit}`}
              className="rounded-lg border border-sand bg-white/70 p-4 scroll-mt-24"
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
                  {!item.allowed ? <PolicyBlockedNote /> : null}
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
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Disconnect ${item.label}? HRMNY will stop using this account until another one is connected.`,
                        )
                      )
                        return;
                      disconnect.mutate({ id: item.connectionAccountId! });
                    }}
                  >
                    {item.toolkit === "google_workspace" &&
                    (item.status === "error" || item.lastError)
                      ? "Clear dead token"
                      : "Disconnect"}
                  </Button>
                ) : null}
              </div>

              {item.authType === "api_key" ? (
                <div className="mt-4 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded border border-sand bg-white px-3 py-2"
                      type="password"
                      disabled={!item.allowed}
                      autoComplete="off"
                      placeholder={
                        item.hasSecret
                          ? "Paste a replacement API key"
                          : "Paste your API key"
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
                            "apollo" | "hunter" | "bayzat" | "n8n",
                          apiKey: keys[item.toolkit]!,
                        });
                      }}
                    >
                      {item.hasSecret ? "Replace" : "Connect"}
                    </Button>
                  </div>
                  {keyNotes[item.toolkit] ? (
                    <p
                      className="text-xs text-emerald-700"
                      data-testid={`conn-key-note-${item.toolkit}`}
                    >
                      {keyNotes[item.toolkit]}
                    </p>
                  ) : null}
                  {saveKey.error &&
                  saveKey.variables?.toolkit === item.toolkit ? (
                    <p className="text-xs text-red-700" role="alert">
                      {saveKey.error.message}
                    </p>
                  ) : null}
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
                      startGoogleWorkspaceOAuth.isPending ||
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
                          .then((result) =>
                            window.location.assign(result.redirectUrl),
                          );
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
                          ? "Reconnect"
                          : "Connect"
                        : item.status === "error" || item.lastError
                          ? "Reconnect"
                          : item.status === "connected"
                            ? "Reconnect"
                            : "Connect"
                      : "Setup required"}
                  </Button>
                  {item.toolkit === "google_workspace" &&
                  isGoogleWorkspaceReconnectRequired(item.lastError) ? (
                    <p className="w-full text-xs text-red-700">
                      Heal cannot restore a revoked Google token. Use Reconnect
                      — it starts a dedicated Google consent that writes tokens
                      to Vault with the same client used for refresh.
                    </p>
                  ) : null}
                  {item.toolkit === "google_workspace" &&
                  item.ready &&
                  (item.status === "error" ||
                    item.status === "connected" ||
                    item.lastError) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={
                        probeGoogle.isPending ||
                        isGoogleWorkspaceReconnectRequired(item.lastError)
                      }
                      onClick={() => void probeGoogle.mutateAsync()}
                    >
                      {probeGoogle.isPending
                        ? "Testing…"
                        : isGoogleWorkspaceReconnectRequired(item.lastError)
                          ? "Heal unavailable — reconnect"
                          : "Test / heal token"}
                    </Button>
                  ) : null}
                  {probeGoogle.data && item.toolkit === "google_workspace" ? (
                    <p
                      className={`w-full text-xs ${
                        probeGoogle.data.ok
                          ? "text-emerald-700"
                          : "text-red-700"
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
                          }${
                            "reconnectRequired" in probeGoogle.data &&
                            probeGoogle.data.reconnectRequired
                              ? " — use Reconnect"
                              : ""
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

      <section
        className="rounded-xl border border-sand bg-white/75 p-5"
        data-testid="sales-sender-mailboxes"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Sales email senders
        </p>
        <h2 className="mt-1 font-display text-xl">
          Approved Google Workspace mailboxes
        </h2>
        <p className="mt-1 text-sm text-muted">
          Sales chooses one approved sender before every Gmail send. Each
          mailbox has its own atomic daily attempt cap.
        </p>
        {salesMailboxes.isLoading ? (
          <p className="mt-4 text-sm text-muted">Loading mailboxes…</p>
        ) : salesMailboxes.data?.items.length ? (
          <div className="mt-4 grid gap-3">
            {salesMailboxes.data.items.map((mailbox) => {
              const edit = mailboxEdits[mailbox.connectionAccountId] ?? {
                label: mailbox.label,
                dailyCap: mailbox.dailyCap,
                enabled: mailbox.enabled,
              };
              return (
                <div
                  key={mailbox.connectionAccountId}
                  className="grid gap-3 rounded-lg border border-sand p-4 lg:grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)_120px_auto] lg:items-end"
                >
                  <div>
                    <strong className="block text-sm">{mailbox.email}</strong>
                    <span className="text-xs text-muted">
                      {mailbox.usedToday} used · {mailbox.remainingToday} left
                      today
                    </span>
                  </div>
                  <label className="text-xs font-medium">
                    Display name
                    <input
                      className="mt-1 w-full rounded border border-sand bg-white px-3 py-2 text-sm"
                      value={edit.label}
                      disabled={!salesMailboxes.data.canManage}
                      onChange={(event) =>
                        setMailboxEdits((current) => ({
                          ...current,
                          [mailbox.connectionAccountId]: {
                            ...edit,
                            label: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="text-xs font-medium">
                    Daily cap
                    <input
                      className="mt-1 w-full rounded border border-sand bg-white px-3 py-2 text-sm"
                      type="number"
                      min={1}
                      max={100}
                      value={edit.dailyCap}
                      disabled={!salesMailboxes.data.canManage}
                      onChange={(event) =>
                        setMailboxEdits((current) => ({
                          ...current,
                          [mailbox.connectionAccountId]: {
                            ...edit,
                            dailyCap: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={edit.enabled}
                        disabled={!salesMailboxes.data.canManage}
                        onChange={(event) =>
                          setMailboxEdits((current) => ({
                            ...current,
                            [mailbox.connectionAccountId]: {
                              ...edit,
                              enabled: event.target.checked,
                            },
                          }))
                        }
                      />
                      Approved
                    </label>
                    {salesMailboxes.data.canManage ? (
                      <Button
                        type="button"
                        disabled={
                          saveMailbox.isPending ||
                          !edit.label.trim() ||
                          edit.dailyCap < 1 ||
                          edit.dailyCap > 100
                        }
                        onClick={() =>
                          saveMailbox.mutate({
                            connectionAccountId: mailbox.connectionAccountId,
                            label: edit.label.trim(),
                            dailyCap: edit.dailyCap,
                            enabled: edit.enabled,
                          })
                        }
                      >
                        Save
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Connect an internal @hrmny.co Google Workspace account first.
          </p>
        )}
        {saveMailbox.error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {saveMailbox.error.message}
          </p>
        ) : null}
      </section>

      <details
        className="rounded-xl border border-sand bg-white/70 p-5"
        onToggle={(event) => setPersonalToolsOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-medium text-ink">
          More personal tools
        </summary>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
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
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Disconnect ${toolkit.name}? You can reconnect it at any time.`,
                          )
                        )
                          return;
                        disconnectManaged.mutate({
                          id: account.connectionAccountId,
                        });
                      }}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
                {!toolkit.allowed ? (
                  <PolicyBlockedNote />
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
      </details>

      {workApps.data?.apps.length ? (
        <details className="flex flex-col gap-4 rounded-xl border border-sand bg-white/70 p-5">
          <summary className="cursor-pointer font-medium text-ink">
            Work app integrations
          </summary>
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
              Composio Work apps are blocked by organization policy. First-party
              CRM cards above stay connectable.{" "}
              <Link href="/admin/work" className="underline">
                Reopen in Admin → Work
              </Link>
              .
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
                      {!item.allowed ? <PolicyBlockedNote /> : null}
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
        </details>
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
      startXeroOAuth.error ||
      startGoogleWorkspaceOAuth.error ||
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
              startXeroOAuth.error ??
              startGoogleWorkspaceOAuth.error ??
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
