"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function NotificationsPage() {
  const utils = trpc.useUtils();
  const list = trpc.notifications.list.useQuery({ limit: 50 });
  const unread = trpc.notifications.unreadCount.useQuery();
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.invalidate();
    },
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => void utils.notifications.invalidate(),
  });

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Inbox
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Notifications
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            OS-wide alerts for tickets, creative jobs, and agent activity.
            Work task inbox stays at{" "}
            <Link className="underline" href="/work/inbox">
              /work/inbox
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-cream px-3 py-1.5 text-xs font-semibold text-muted">
            {unread.data?.count ?? 0} unread
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </Button>
        </div>
      </header>

      <section className="rounded-xl border border-sand bg-white/75">
        {list.isLoading ? (
          <p className="p-6 text-sm text-muted">Loading…</p>
        ) : (list.data?.length ?? 0) === 0 ? (
          <p className="p-6 text-sm text-muted">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-sand">
            {(list.data ?? []).map((n) => (
              <li
                key={n.osNotificationId}
                className={`px-4 py-3 ${n.readAt ? "opacity-70" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{n.title}</p>
                    {n.body ? (
                      <p className="mt-1 text-sm text-muted">{n.body}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">
                      {n.kind} · {n.createdAt.slice(0, 19)}
                      {n.href ? (
                        <>
                          {" · "}
                          <Link className="underline" href={n.href}>
                            Open
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {!n.readAt ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={markRead.isPending}
                      onClick={() =>
                        markRead.mutate({ id: n.osNotificationId })
                      }
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
