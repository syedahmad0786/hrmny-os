"use client";

import { useState } from "react";
import { WorkNav } from "@/components/work-nav";
import { trpc } from "@/lib/trpc";

export default function WorkInboxPage() {
  const utils = trpc.useUtils();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inbox = trpc.work.personal.inbox.useQuery({ unreadOnly });
  const mark = trpc.work.personal.markNotification.useMutation({
    onSuccess: () => utils.work.personal.inbox.invalidate(),
  });

  return (
    <main className="flex flex-col gap-5">
      <WorkNav />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Updates
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Inbox</h1>
          <p className="mt-2 text-sm text-muted">
            Assignment, comment, completion, and follower updates you can
            access.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          Unread only
        </label>
      </header>
      <section className="overflow-hidden rounded-xl border border-sand bg-white/70">
        {(inbox.data ?? []).map((notification) => (
          <article
            key={notification.notificationId}
            className={`flex items-start justify-between gap-4 border-b border-sand p-4 last:border-0 ${notification.readAt ? "opacity-60" : "bg-white"}`}
          >
            <div>
              <p className="text-sm font-medium">{notification.message}</p>
              <p className="mt-1 text-xs text-muted">
                {notification.eventType.replaceAll("_", " ")} ·{" "}
                {new Date(notification.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 gap-2 text-xs">
              <button
                type="button"
                className="rounded border border-sand px-2 py-1"
                onClick={() =>
                  mark.mutate({
                    notificationId: notification.notificationId,
                    read: !notification.readAt,
                    dismissed: false,
                  })
                }
              >
                {notification.readAt ? "Unread" : "Read"}
              </button>
              <button
                type="button"
                className="rounded border border-sand px-2 py-1"
                onClick={() =>
                  mark.mutate({
                    notificationId: notification.notificationId,
                    read: true,
                    dismissed: true,
                  })
                }
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
        {!inbox.isLoading && !inbox.data?.length ? (
          <p className="p-8 text-center text-sm text-muted">Inbox is clear.</p>
        ) : null}
      </section>
      {inbox.error || mark.error ? (
        <p className="text-sm text-red-700">
          {(inbox.error ?? mark.error)?.message}
        </p>
      ) : null}
    </main>
  );
}
