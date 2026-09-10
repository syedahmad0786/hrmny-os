"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Providers } from "@/components/providers";
import { linkedinProfileUrl } from "@/lib/linkedin-profile";
import { trpc } from "@/lib/trpc";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GateOutcome = {
  ok: boolean;
  code?: string;
  reason?: string;
  blockedBy?: { gate: string; reason: string }[];
};

export default function OutreachReviewPage() {
  return (
    <Providers>
      <OutreachReview />
    </Providers>
  );
}

function OutreachReview() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const validId = UUID.test(id);
  const utils = trpc.useUtils();
  const review = trpc.leadgen.outreach.review.useQuery(
    { id },
    { enabled: validId },
  );
  const mailboxes = trpc.connections.salesMailboxes.useQuery(undefined, {
    enabled: validId,
  });
  const approve = trpc.leadgen.outreach.reviewApprove.useMutation();
  const send = trpc.leadgen.outreach.reviewSend.useMutation();
  const [senderId, setSenderId] = useState("");
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "send" | null>(null);

  if (!validId)
    return (
      <ReviewFrame>
        <Notice title="Invalid outreach link">
          The outreach id must be a valid UUID.
        </Notice>
      </ReviewFrame>
    );
  if (review.isLoading)
    return (
      <ReviewFrame>
        <p className="text-sm text-muted">Loading outreach review…</p>
      </ReviewFrame>
    );
  if (review.error)
    return (
      <ReviewFrame>
        <Notice title="Could not load outreach" error>
          <p>{review.error.message}</p>
          <button className="crm-btn" onClick={() => void review.refetch()}>
            Retry
          </button>
        </Notice>
      </ReviewFrame>
    );
  const data = review.data;
  if (!data?.item)
    return (
      <ReviewFrame>
        <Notice title="Outreach not found">
          This review link is unavailable or no longer visible.
        </Notice>
      </ReviewFrame>
    );

  const item = data.item;
  const snapshotHash = data.snapshotHash;
  const isEmail =
    item.channel === "gmail" ||
    item.channel === "email" ||
    item.channel.startsWith("email_");
  const profile = linkedinProfileUrl(item.linkedinUrl ?? item.recipient);
  const body = isEmail ? item.body : (editedBody ?? item.body);
  const selectedMailbox = mailboxes.data?.items.find(
    (m) => m.connectionAccountId === senderId,
  );
  const canSend =
    isEmail &&
    item.state === "approved" &&
    Boolean(selectedMailbox) &&
    data.ready;

  async function refresh(message: string) {
    setFeedback(message);
    setEditedBody(null);
    await utils.leadgen.outreach.review.invalidate({ id });
  }
  async function approveDraft() {
    setBusy("approve");
    setFeedback(null);
    try {
      const result = (await approve.mutateAsync({
        id,
        snapshotHash,
      })) as GateOutcome;
      await refresh(
        result.ok
          ? "Draft approved. Review the sender before sending."
          : (result.reason ?? result.code ?? "Approval blocked."),
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setBusy(null);
    }
  }
  async function sendEmail() {
    if (!selectedMailbox) return;
    setBusy("send");
    setFeedback(null);
    try {
      const result = (await send.mutateAsync({
        id,
        snapshotHash,
        senderConnectionAccountId: selectedMailbox.connectionAccountId,
      })) as GateOutcome;
      await refresh(
        result.ok
          ? "Email send completed and the review was refreshed."
          : (result.reason ?? result.code ?? "Send blocked."),
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setBusy(null);
    }
  }
  async function copyLinkedIn() {
    try {
      await navigator.clipboard.writeText(body);
      setFeedback("Copied. Paste into LinkedIn and send manually.");
    } catch {
      setFeedback(
        "Clipboard copy failed. Select the draft and copy it manually.",
      );
    }
  }

  return (
    <ReviewFrame>
      <article className="crm-panel max-w-3xl">
        <div className="crm-panel-head">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
              Human review
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Outreach draft</h1>
          </div>
          <span className="crm-tag">{item.state}</span>
        </div>
        <div className="crm-panel-body grid gap-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-muted">
                Channel
              </dt>
              <dd>{item.channel}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-muted">
                Recipient
              </dt>
              <dd className="break-words">{item.recipient}</dd>
            </div>
          </dl>
          <div>
            <h2 className="text-xs font-semibold uppercase text-muted">
              Subject
            </h2>
            <p className="mt-1">
              {isEmail
                ? (item.subject ?? "(no subject)")
                    .replace(/[\r\n]+/g, " ")
                    .trim()
                    .slice(0, 200)
                : item.subject}
            </p>
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase text-muted">
              Full body
            </h2>
            <textarea
              className="crm-input mt-1 min-h-56 w-full font-mono text-sm"
              value={body}
              readOnly={isEmail}
              onChange={(e) => setEditedBody(e.target.value)}
              aria-label="Outreach body"
            />
          </div>
          <div className="rounded border border-sand bg-paper p-3 text-sm">
            <strong>Current state:</strong> {item.state}
            {data.reason ? (
              <span className="ml-2 text-muted">· {data.reason}</span>
            ) : null}
          </div>
          {isEmail ? (
            <>
              <label className="grid gap-1 text-sm">
                <span className="font-semibold">Send from</span>
                <select
                  className="crm-input"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                >
                  <option value="">Select a named mailbox</option>
                  {(mailboxes.data?.items ?? []).map((m) => (
                    <option
                      key={m.connectionAccountId}
                      value={m.connectionAccountId}
                    >
                      {m.label} · {m.email}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="crm-btn"
                  disabled={
                    busy !== null || review.isFetching || item.state !== "draft"
                  }
                  onClick={() => void approveDraft()}
                >
                  Approve draft
                </button>
                <button
                  className="crm-btn crm-btn-primary"
                  disabled={busy !== null || review.isFetching || !canSend}
                  onClick={() => void sendEmail()}
                >
                  Send this email
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="crm-btn" onClick={() => void copyLinkedIn()}>
                Copy text
              </button>
              {profile ? (
                <a
                  className="crm-btn crm-btn-primary"
                  href={profile}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open LinkedIn
                </a>
              ) : (
                <span className="text-sm text-muted">
                  No valid public LinkedIn profile URL.
                </span>
              )}
            </div>
          )}
          {mailboxes.error ? (
            <p className="text-sm text-muted">
              Mailbox list unavailable: {mailboxes.error.message}
            </p>
          ) : null}
          {isEmail && !(mailboxes.data?.items?.length ?? 0) ? (
            <a
              className="text-sm underline"
              href="/settings/connections"
              target="_blank"
              rel="noreferrer"
            >
              Connect a sales mailbox
            </a>
          ) : null}
          {review.isFetching ? (
            <p className="text-sm text-muted" role="status">
              Refreshing review…
            </p>
          ) : null}
          {feedback ? (
            <p className="text-sm" role="status">
              {feedback}
            </p>
          ) : null}
          <Link
            className="text-sm underline"
            href={`/crm/outreach?id=${encodeURIComponent(id)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open full outreach for rework
          </Link>
        </div>
      </article>
    </ReviewFrame>
  );
}

function ReviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      {children}
    </main>
  );
}
function Notice({
  title,
  children,
  error = false,
}: {
  title: string;
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <section
      className={`crm-panel max-w-xl p-6 ${error ? "border-ochre" : ""}`}
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="mt-2 grid gap-3 text-sm text-muted">
        {children}
        <Link className="underline" href="/login" target="_blank">
          Sign in
        </Link>
      </div>
    </section>
  );
}
