"use client";

import Link from "next/link";
import { Button, Card } from "@hrmny/ui";
import { useState } from "react";
import { CrmSubnav } from "@/components/crm/subnav";
import { OnboardingReadyBanner } from "@/components/onboarding-ready-banner";
import { trpc } from "@/lib/trpc";
import { deliveryRhythmFor } from "@/lib/delivery-rhythm";

type ClientRow = {
  clientId: string;
  name: string;
  market: string;
  engagementType: string;
  lifecycleStatus: string;
  portalUserCount?: number;
};

export default function ClientsPage() {
  const utils = trpc.useUtils();
  const clients = trpc.clients.list.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [market, setMarket] = useState<"UAE" | "KSA" | "Both">("UAE");
  const [engagementType, setEngagementType] = useState<"project" | "retainer">(
    "project",
  );
  const [contractValue, setContractValue] = useState("");
  const [accessClientId, setAccessClientId] = useState<string | null>(null);
  const [portalName, setPortalName] = useState("");
  const [portalEmail, setPortalEmail] = useState("");
  const portalUsers = trpc.clients.portalUsers.list.useQuery(
    { clientId: accessClientId! },
    { enabled: Boolean(accessClientId) },
  );
  const createClient = trpc.clients.create.useMutation({
    onSuccess: async () => {
      setName("");
      setContractValue("");
      setShowCreate(false);
      await utils.clients.list.invalidate();
    },
  });
  const [demoPortalLink, setDemoPortalLink] = useState<string | null>(null);
  const [inviteDeliveryNote, setInviteDeliveryNote] = useState<string | null>(
    null,
  );
  const invitePortalUser = trpc.clients.portalUsers.invite.useMutation({
    onSuccess: async (data) => {
      setPortalName("");
      setPortalEmail("");
      const mode = data.delivery?.mode;
      setInviteDeliveryNote(
        mode === "live"
          ? `Invite emailed — open ${data.portalPath}`
          : mode === "mock"
            ? `Invite ready (email not sent — Resend mock). Open magic link: ${data.portalPath}`
            : data.portalPath
              ? `Invite ready — open ${data.portalPath}`
              : null,
      );
      if (data.portalPath) setDemoPortalLink(data.portalPath);
      await Promise.all([
        utils.clients.list.invalidate(),
        utils.clients.portalUsers.list.invalidate(),
      ]);
    },
  });
  const issueDemoToken = trpc.clients.portalUsers.issueDemoToken.useMutation({
    onSuccess: (data) => {
      setDemoPortalLink(data.portalPath);
      const mode = data.delivery?.mode;
      setInviteDeliveryNote(
        mode === "live"
          ? "Magic link emailed"
          : mode === "mock"
            ? "Magic link ready (email not sent — Resend mock)"
            : null,
      );
    },
  });
  const rows = (clients.data ?? []) as ClientRow[];

  return (
    <main className="flex flex-col gap-6">
      <CrmSubnav />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            CRM
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Client directory
          </h1>
          <p className="mt-2 text-sm text-muted">
            Create client accounts, grant portal access, and open each client’s
            exact portal view.
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreate((value) => !value)}>
          + Add client
        </Button>
      </header>

      <OnboardingReadyBanner testIdPrefix="clients" />

      {showCreate ? (
        <form
          className="grid gap-3 rounded-xl border border-sand bg-white/75 p-4 md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            createClient.mutate({
              name,
              market,
              engagementType,
              contractValue: Number(contractValue || 0),
            });
          }}
        >
          <input
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Client name"
            minLength={2}
            maxLength={200}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <select
            aria-label="Market"
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={market}
            onChange={(event) => setMarket(event.target.value as typeof market)}
          >
            <option value="UAE">UAE</option>
            <option value="KSA">KSA</option>
            <option value="Both">Both</option>
          </select>
          <select
            aria-label="Engagement type"
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={engagementType}
            onChange={(event) =>
              setEngagementType(event.target.value as typeof engagementType)
            }
          >
            <option value="project">Project</option>
            <option value="retainer">Retainer</option>
          </select>
          <input
            aria-label="Contract value"
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            type="number"
            min="0"
            step="0.01"
            placeholder="Value (AED)"
            value={contractValue}
            onChange={(event) => setContractValue(event.target.value)}
          />
          <Button
            type="submit"
            disabled={createClient.isPending || !name.trim()}
          >
            Create
          </Button>
        </form>
      ) : null}

      {createClient.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {createClient.error.message}
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        {rows.map((client) => (
          <Card key={client.clientId} className="!p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">
                  {client.name}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {client.market} ·{" "}
                  {deliveryRhythmFor(client.engagementType).label} ·{" "}
                  {client.lifecycleStatus}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {client.portalUserCount ?? 0} active portal user
                  {(client.portalUserCount ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <span className="rounded-full bg-ochre/10 px-2 py-1 text-xs font-medium text-ochre">
                {client.lifecycleStatus.replaceAll("_", " ")}
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white"
                href={`/client-preview?client=${client.clientId}`}
              >
                Preview portal
              </Link>
              <Link
                className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                href={`/clients/${client.clientId}`}
              >
                Onboarding
              </Link>
              <button
                type="button"
                data-testid={`clients-manage-portal-${client.clientId}`}
                className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                onClick={() => setAccessClientId(client.clientId)}
              >
                Manage portal access
              </button>
            </div>
          </Card>
        ))}
        {!clients.isLoading && rows.length === 0 ? (
          <Card className="!p-5 text-sm text-muted">
            No clients yet. Use “Add client” to create the first account.
          </Card>
        ) : null}
      </section>

      {accessClientId ? (
        <section
          className="rounded-xl border border-sand bg-white/75 p-5"
          data-testid="clients-portal-access-panel"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">
                Portal access
              </h2>
              <p className="text-sm text-muted">
                Invite a client contact. Their secure magic-link sign-in must
                use this email.
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-muted underline"
              onClick={() => setAccessClientId(null)}
            >
              Close
            </button>
          </div>
          <form
            className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              invitePortalUser.mutate({
                clientId: accessClientId,
                displayName: portalName,
                email: portalEmail,
              });
            }}
          >
            <input
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              data-testid="clients-portal-invite-name"
              placeholder="Contact name"
              minLength={2}
              required
              value={portalName}
              onChange={(event) => setPortalName(event.target.value)}
            />
            <input
              className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
              data-testid="clients-portal-invite-email"
              type="email"
              placeholder="contact@client.com"
              required
              value={portalEmail}
              onChange={(event) => setPortalEmail(event.target.value)}
            />
            <Button
              type="submit"
              data-testid="clients-portal-invite-submit"
              disabled={invitePortalUser.isPending}
            >
              Grant access
            </Button>
          </form>
          {invitePortalUser.error ? (
            <p className="mt-3 text-sm text-red-700">
              {invitePortalUser.error.message}
            </p>
          ) : null}
          {inviteDeliveryNote ? (
            <p
              className="mt-3 text-sm text-muted"
              data-testid="clients-portal-invite-note"
            >
              {inviteDeliveryNote}
            </p>
          ) : null}
          {issueDemoToken.error ? (
            <p className="mt-3 text-sm text-red-700">
              {issueDemoToken.error.message}
            </p>
          ) : null}
          {demoPortalLink ? (
            <p
              className="mt-3 rounded-lg border border-sand bg-cream/40 p-3 text-sm"
              data-testid="clients-portal-demo-link"
            >
              Demo portal link (single-use):{" "}
              <a
                className="font-medium text-ochre underline"
                href={demoPortalLink}
                data-testid="clients-portal-demo-link-href"
              >
                {demoPortalLink}
              </a>
            </p>
          ) : null}
          <div className="mt-4 space-y-2 text-sm">
            {(portalUsers.data ?? []).map((user) => (
              <div
                key={user.portalUserId}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-sand/70 pt-2"
              >
                <span>
                  {user.displayName} · {user.email}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-muted">
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                  {user.isActive && user.email ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-ochre underline"
                      disabled={issueDemoToken.isPending}
                      onClick={() =>
                        issueDemoToken.mutate({
                          clientId: accessClientId,
                          email: user.email,
                        })
                      }
                    >
                      Open portal link
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
