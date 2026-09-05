"use client";

import Link from "next/link";
import { useState } from "react";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTag } from "@/components/crm/ui";
import { formatRelative } from "@/components/crm/format";
import { trpc } from "@/lib/trpc";

export default function SalesInboxPage() {
  const utils = trpc.useUtils();
  const conversations = trpc.leadgen.outreach.conversations.useQuery();
  const [replyBody, setReplyBody] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const draftReply = trpc.leadgen.outreach.draftReply.useMutation({
    onSuccess: () => {
      setError(null);
      void utils.leadgen.outreach.invalidate();
    },
    onError: (cause) => setError(cause.message),
  });

  return (
    <main className="crm-page">
      <CrmPageHeader
        kicker="Sales · Gmail conversations"
        title="Sales inbox"
        description="Client replies are matched to their CRM deal. Draft here, then use the existing human approval and named-sender controls in Outreach."
        actions={<CrmTag kind="info">Nothing sends automatically</CrmTag>}
      />

      {error ? (
        <div
          className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {conversations.isLoading ? <p>Loading Gmail replies…</p> : null}
      {conversations.error ? (
        <CrmEmpty
          title="Inbox could not load"
          hint={conversations.error.message}
        />
      ) : null}
      {conversations.data?.length === 0 ? (
        <CrmEmpty
          title="No Gmail replies yet"
          hint="Replies appear here after the connected Gmail webhook verifies and matches them to sent outreach."
        />
      ) : null}

      <div className="grid gap-5">
        {conversations.data?.map((conversation) => {
          const body = replyBody[conversation.id] ?? "";
          return (
            <article
              key={conversation.id}
              id={`conversation-${conversation.id}`}
              data-testid="sales-conversation"
              className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="crm-eyebrow">
                    Reply received ·{" "}
                    {formatRelative(conversation.latestInboundAt)}
                  </p>
                  <h2 className="font-display text-xl text-ink">
                    {conversation.companyName}
                  </h2>
                  <p className="text-sm text-stone-600">
                    {conversation.contactName}
                    {conversation.contactEmail
                      ? ` · ${conversation.contactEmail}`
                      : ""}
                  </p>
                  <p className="mt-2 font-semibold text-stone-900">
                    {conversation.subject ?? "Gmail conversation"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {conversation.dealId ? (
                    <Link
                      className="crm-btn"
                      href={`/crm/deals/${conversation.dealId}`}
                    >
                      Open deal
                    </Link>
                  ) : (
                    <CrmTag kind="warn">Needs CRM association</CrmTag>
                  )}
                </div>
              </div>

              <div
                className="mt-4 grid gap-2"
                aria-label="Conversation messages"
              >
                {conversation.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-3xl rounded-xl border p-3 text-sm ${
                      message.direction === "inbound"
                        ? "border-emerald-200 bg-emerald-50"
                        : "ml-auto border-stone-200 bg-stone-50"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-wide text-stone-500">
                      <span>
                        {message.direction === "inbound" ? "Client" : "hrmny"}
                      </span>
                      <span>{message.status}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-stone-800">
                      {message.body ||
                        "Provider event recorded; message body unavailable."}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 border-t border-stone-200 pt-4">
                {conversation.replyDraftId ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4">
                    <div>
                      <strong className="block text-stone-900">
                        Reply draft ready
                      </strong>
                      <span className="text-sm text-stone-600">
                        Review the copy, approve it, and choose the connected
                        sender.
                      </span>
                    </div>
                    <Link
                      className="crm-btn primary"
                      data-testid="review-reply-draft"
                      href={`/crm/outreach?id=${conversation.replyDraftId}`}
                    >
                      Review and approve reply
                    </Link>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <label className="grid gap-1 text-sm font-semibold text-stone-800">
                      Reply direction (optional)
                      <textarea
                        className="min-h-24 rounded-xl border border-stone-300 bg-white p-3 font-normal"
                        value={body}
                        onChange={(event) =>
                          setReplyBody((current) => ({
                            ...current,
                            [conversation.id]: event.target.value,
                          }))
                        }
                        placeholder="Write the reply, or leave blank for an AI-assisted draft based on this conversation."
                        disabled={
                          !conversation.dealId || !conversation.contactEmail
                        }
                      />
                    </label>
                    <div>
                      <CrmBtn
                        variant="primary"
                        data-testid="draft-conversation-reply"
                        disabled={
                          !conversation.dealId ||
                          !conversation.contactEmail ||
                          draftReply.isPending
                        }
                        onClick={() =>
                          draftReply.mutate({
                            conversationId: conversation.id,
                            ...(body.trim() ? { body: body.trim() } : {}),
                          })
                        }
                      >
                        {draftReply.isPending
                          ? "Creating draft…"
                          : "Create reply draft"}
                      </CrmBtn>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
