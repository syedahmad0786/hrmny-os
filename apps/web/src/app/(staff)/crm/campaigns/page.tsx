"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTag } from "@/components/crm/ui";
import { trpc } from "@/lib/trpc";

const DEFAULT_SUBJECT = "An idea for {{company}}";
const DEFAULT_BODY =
  "Hi {{firstName}}, I noticed the work {{company}} is doing in the region. hrmny has a focused creative angle that could support the next campaign without adding review overhead. Would a short 15-minute conversation next week be useful?";

export default function SalesCampaignsPage() {
  const utils = trpc.useUtils();
  const campaigns = trpc.salesOs.campaigns.list.useQuery();
  const deals = trpc.crm.deals.list.useQuery();
  const [name, setName] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState(DEFAULT_SUBJECT);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      utils.salesOs.campaigns.list.invalidate(),
      utils.leadgen.outreach.list.invalidate(),
      utils.leadgen.outreach.followups.invalidate(),
    ]);
  };
  const create = trpc.salesOs.campaigns.create.useMutation({
    onSuccess: async (campaign) => {
      setMessage(`${campaign.name} created. Nothing was sent.`);
      setName("");
      setSelected([]);
      await refresh();
    },
    onError: (error) => setMessage(error.message),
  });
  const prepareFirst = trpc.salesOs.campaigns.prepareFirstTouch.useMutation({
    onSuccess: async (result) => {
      setMessage(
        `${Number("drafted" in result ? result.drafted : 0)} first-touch drafts prepared · 0 sent.`,
      );
      await refresh();
    },
    onError: (error) => setMessage(error.message),
  });
  const prepareFollowups = trpc.salesOs.campaigns.prepareFollowups.useMutation({
    onSuccess: async (result) => {
      setMessage(
        `${Number("drafted" in result ? result.drafted : 0)} follow-up drafts prepared · 0 sent.`,
      );
      await refresh();
    },
    onError: (error) => setMessage(error.message),
  });
  const setStatus = trpc.salesOs.campaigns.setStatus.useMutation({
    onSuccess: async (campaign) => {
      setMessage(`${campaign.name} is ${campaign.status}.`);
      await refresh();
    },
    onError: (error) => setMessage(error.message),
  });

  const availableDeals = useMemo(
    () => (deals.data ?? []).filter((deal) => !deal.closeOutcome),
    [deals.data],
  );
  const busy =
    create.isPending ||
    prepareFirst.isPending ||
    prepareFollowups.isPending ||
    setStatus.isPending;

  return (
    <main data-testid="sales-campaigns-page">
      <CrmPageHeader
        kicker="Sales · Campaign execution"
        title="Campaigns"
        description="Group leads, prepare personalized drafts, and monitor every reply or stop signal. Campaign controls never send client email."
        actions={
          <>
            <Link href="/crm/outreach" className="crm-btn">
              Review outreach
            </Link>
            <Link href="/crm/dashboard" className="crm-btn">
              Sales dashboard
            </Link>
          </>
        }
      />

      <section className="crm-panel mb-4" data-testid="campaign-create-panel">
        <div className="crm-panel-head">
          <div>
            <h2 className="font-display text-xl font-semibold">
              Create a campaign
            </h2>
            <p>
              Select active CRM leads. Only verified, unsuppressed emails become
              drafts.
            </p>
          </div>
          <CrmTag kind="success">Draft-only</CrmTag>
        </div>
        <form
          className="crm-panel-body grid gap-4 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            create.mutate({
              name,
              dealIds: selected,
              subjectTemplate,
              bodyTemplate,
            });
          }}
        >
          <div className="grid content-start gap-3">
            <label className="crm-field">
              <span>Campaign name</span>
              <input
                data-testid="campaign-name"
                className="crm-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="UAE hospitality September"
                required
              />
            </label>
            <label className="crm-field">
              <span>Subject template</span>
              <input
                data-testid="campaign-subject"
                className="crm-input"
                value={subjectTemplate}
                onChange={(event) => setSubjectTemplate(event.target.value)}
                required
              />
            </label>
            <label className="crm-field">
              <span>Message template</span>
              <textarea
                data-testid="campaign-body"
                className="crm-input min-h-32"
                value={bodyTemplate}
                onChange={(event) => setBodyTemplate(event.target.value)}
                required
              />
              <small>
                Use {"{{firstName}}"} and {"{{company}}"}. Every generated item
                waits in Outreach for human review.
              </small>
            </label>
          </div>
          <fieldset className="rounded-xl border border-[var(--line)] p-3">
            <legend className="px-1 text-xs font-semibold">
              Choose leads · {selected.length} selected
            </legend>
            <div className="mt-2 grid max-h-64 gap-2 overflow-auto">
              {availableDeals.map((deal) => (
                <label
                  key={deal.dealId}
                  className="flex items-start gap-2 rounded-lg bg-[var(--muted-surface-soft)] p-3 text-xs"
                >
                  <input
                    type="checkbox"
                    data-testid={`campaign-deal-${deal.dealId}`}
                    checked={selected.includes(deal.dealId)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, deal.dealId]
                          : current.filter((id) => id !== deal.dealId),
                      )
                    }
                  />
                  <span>
                    <strong className="block">{deal.companyName}</strong>
                    <small>
                      {deal.stage} · {deal.leadSourceLane}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <CrmBtn
              data-testid="campaign-create"
              className="mt-3"
              variant="primary"
              type="submit"
              disabled={busy || !name.trim() || selected.length === 0}
            >
              {create.isPending ? "Creating…" : "Create campaign"}
            </CrmBtn>
          </fieldset>
        </form>
      </section>

      {message ? (
        <p className="crm-note mb-4" role="status">
          {message}
        </p>
      ) : null}

      <section aria-label="Campaign progress" className="grid gap-4">
        {campaigns.isLoading ? (
          <CrmEmpty title="Loading campaigns…" />
        ) : campaigns.error ? (
          <CrmEmpty
            title="Campaigns unavailable"
            hint={campaigns.error.message}
          />
        ) : campaigns.data?.length ? (
          campaigns.data.map((campaign) => (
            <article
              className="crm-panel"
              key={campaign.id}
              data-testid={`campaign-${campaign.id}`}
            >
              <div className="crm-panel-head flex-wrap justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold">
                    {campaign.name}
                  </h2>
                  <p>
                    {campaign.progress.total} leads · updated{" "}
                    {new Date(campaign.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CrmTag
                    kind={
                      campaign.status === "running"
                        ? "success"
                        : campaign.status === "paused"
                          ? "warn"
                          : "info"
                    }
                  >
                    {campaign.status}
                  </CrmTag>
                  <CrmBtn
                    data-testid={`campaign-first-${campaign.id}`}
                    disabled={
                      busy ||
                      campaign.status === "paused" ||
                      campaign.status === "completed"
                    }
                    onClick={() =>
                      prepareFirst.mutate({
                        campaignId: campaign.id,
                        runId: crypto.randomUUID(),
                      })
                    }
                  >
                    Prepare first drafts
                  </CrmBtn>
                  <CrmBtn
                    data-testid={`campaign-followups-${campaign.id}`}
                    disabled={busy || campaign.status !== "running"}
                    onClick={() =>
                      prepareFollowups.mutate({
                        campaignId: campaign.id,
                        runId: crypto.randomUUID(),
                      })
                    }
                  >
                    Prepare due follow-ups
                  </CrmBtn>
                  {campaign.status === "paused" ? (
                    <CrmBtn
                      disabled={busy}
                      onClick={() =>
                        setStatus.mutate({
                          campaignId: campaign.id,
                          status: "running",
                        })
                      }
                    >
                      Resume
                    </CrmBtn>
                  ) : campaign.status !== "completed" ? (
                    <CrmBtn
                      disabled={busy}
                      onClick={() =>
                        setStatus.mutate({
                          campaignId: campaign.id,
                          status: "paused",
                        })
                      }
                    >
                      Pause
                    </CrmBtn>
                  ) : null}
                </div>
              </div>
              <div
                className="grid gap-px bg-[var(--line)] sm:grid-cols-4 lg:grid-cols-8"
                data-testid={`campaign-progress-${campaign.id}`}
              >
                {[
                  ["Ready", campaign.progress.ready],
                  ["Drafts", campaign.progress.drafted],
                  ["Approved", campaign.progress.approved],
                  ["Sent", campaign.progress.sent],
                  ["Replies", campaign.progress.replied],
                  ["Stopped", campaign.progress.stopped],
                  ["Blocked", campaign.progress.blocked],
                  ["Follow-ups due", campaign.progress.followupsDue],
                ].map(([label, value]) => (
                  <div key={String(label)} className="bg-[var(--paper-2)] p-3">
                    <span className="crm-metric-label">{label}</span>
                    <strong className="mt-1 block font-display text-2xl">
                      {value}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-semibold">Lead status</h3>
                  <ol className="m-0 list-none divide-y divide-[var(--line)] p-0">
                    {campaign.members.map((member) => (
                      <li
                        key={member.dealId}
                        className="flex justify-between gap-3 py-2 text-xs"
                      >
                        <span>
                          <Link
                            className="font-semibold underline"
                            href={`/crm/deals/${member.dealId}`}
                          >
                            {member.companyName}
                          </Link>
                          <small className="mt-1 block text-[var(--muted)]">
                            {member.reason}
                          </small>
                        </span>
                        <CrmTag
                          kind={
                            member.state === "replied" ||
                            member.state === "ready"
                              ? "success"
                              : member.state === "blocked" ||
                                  member.state === "stopped"
                                ? "danger"
                                : "info"
                          }
                        >
                          {member.state}
                        </CrmTag>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold">Run receipts</h3>
                  {campaign.receipts.length ? (
                    <ol
                      className="m-0 list-none divide-y divide-[var(--line)] p-0"
                      data-testid={`campaign-receipts-${campaign.id}`}
                    >
                      {campaign.receipts.map((receipt) => (
                        <li key={receipt.receiptId} className="py-2 text-xs">
                          <strong>
                            {receipt.kind === "first_touch"
                              ? "First drafts"
                              : "Follow-ups"}
                          </strong>
                          <span className="mt-1 block text-[var(--muted)]">
                            {receipt.summary}
                          </span>
                          <code className="mt-1 block text-[9px]">
                            {receipt.receiptId}
                          </code>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">
                      No runs yet. Creating the campaign did not draft or send
                      anything.
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))
        ) : (
          <CrmEmpty
            title="No campaigns yet"
            hint="Create one above from active CRM leads."
          />
        )}
      </section>
    </main>
  );
}
