"use client";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export function PersonalMailbox() {
  const mailboxes = trpc.connections.myMailboxes.useQuery();
  const [selected, setSelected] = useState("");
  const accountId =
    selected ||
    mailboxes.data?.find((item) => item.status === "connected")
      ?.connectionAccountId ||
    mailboxes.data?.[0]?.connectionAccountId ||
    "";
  const [folder, setFolder] = useState<"INBOX" | "SENT">("INBOX");
  const [pages, setPages] = useState<string[]>([]);
  const [messageId, setMessageId] = useState("");
  const page = trpc.connections.mailboxPage.useQuery(
    { connectionAccountId: accountId, folder, pageToken: pages.at(-1) },
    { enabled: Boolean(accountId), retry: false },
  );
  const message = trpc.connections.mailboxMessage.useQuery(
    { connectionAccountId: accountId, id: messageId },
    { enabled: Boolean(accountId && messageId), retry: false },
  );
  const reset = () => {
    setPages([]);
    setMessageId("");
  };
  return (
    <section className="crm-panel mb-5" aria-label="Your private mailbox">
      <div className="crm-panel-head">
        <div>
          <h2>Your mailbox</h2>
          <p>Only you can open this inbox and sent mail.</p>
        </div>
        <Link className="crm-btn" href="/settings/connections#my-mailboxes">
          Manage mailboxes
        </Link>
      </div>
      <div className="crm-panel-body">
        {mailboxes.error ? <p role="alert">{mailboxes.error.message}</p> : null}
        {!accountId ? (
          <p>
            {mailboxes.isLoading
              ? "Loading your mailboxes…"
              : "Connect your own Google mailbox to read incoming and sent messages here."}
          </p>
        ) : (
          <>
            <label className="crm-field">
              <span>Mailbox</span>
              <select
                value={accountId}
                onChange={(event) => {
                  setSelected(event.target.value);
                  reset();
                }}
              >
                {mailboxes.data?.map((item) => (
                  <option
                    key={item.connectionAccountId}
                    value={item.connectionAccountId}
                  >
                    {item.email} · {item.status}
                  </option>
                ))}
              </select>
            </label>
            <div className="sales-work-tabs" aria-label="Mailbox folders">
              {(["INBOX", "SENT"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={folder === value}
                  onClick={() => {
                    setFolder(value);
                    reset();
                  }}
                >
                  {value === "INBOX" ? "Inbox" : "Sent"}
                </button>
              ))}
              <button
                disabled={page.isFetching}
                onClick={() => {
                  setMessageId("");
                  void page.refetch();
                }}
              >
                Refresh
              </button>
            </div>
            {page.error ? (
              <p role="alert">{page.error.message}</p>
            ) : page.isLoading ? (
              <p>Loading messages…</p>
            ) : (
              <>
                {!page.data?.messages.length ? (
                  <p>No messages in this folder.</p>
                ) : null}
                <ul className="divide-y divide-[var(--line)]">
                  {page.data?.messages.map((item) => (
                    <li key={item.id} className="py-3">
                      <button
                        className="w-full text-left"
                        aria-expanded={messageId === item.id}
                        onClick={() =>
                          setMessageId(messageId === item.id ? "" : item.id)
                        }
                      >
                        <strong className="block">
                          {item.subject || "(No subject)"}
                        </strong>
                        <span className="block text-sm">
                          {folder === "INBOX" ? item.from : item.to}
                        </span>
                        <span className="block truncate text-sm text-[var(--muted)]">
                          {item.snippet}
                        </span>
                      </button>
                      {messageId === item.id ? (
                        <div className="mt-3 whitespace-pre-wrap break-words text-sm">
                          {message.error ? (
                            <p role="alert">{message.error.message}</p>
                          ) : message.isLoading ? (
                            "Opening message…"
                          ) : (
                            message.data?.body
                          )}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 mt-3">
                  <button
                    className="crm-btn"
                    disabled={!pages.length}
                    onClick={() => {
                      setPages(pages.slice(0, -1));
                      setMessageId("");
                    }}
                  >
                    Newer
                  </button>
                  <button
                    className="crm-btn"
                    disabled={!page.data?.nextPageToken}
                    onClick={() => {
                      setPages([...pages, page.data!.nextPageToken!]);
                      setMessageId("");
                    }}
                  >
                    Older
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
