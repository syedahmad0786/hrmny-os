"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function TicketsPage() {
  const utils = trpc.useUtils();
  const list = trpc.tickets.list.useQuery({});
  const create = trpc.tickets.create.useMutation({
    onSuccess: () => {
      void utils.tickets.list.invalidate();
      setSubject("");
      setBody("");
    },
  });
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">(
    "medium",
  );

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Support
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">Tickets</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Triage employee and client requests. Assignees get an OS notification.
          </p>
        </div>
        <Link
          className="rounded-full border border-sand bg-white px-4 py-2 text-sm"
          href="/notifications"
        >
          Notifications
        </Link>
      </header>

      <section className="rounded-xl border border-sand bg-white/75 p-4">
        <h2 className="font-display text-lg font-semibold">New ticket</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <select
            className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as typeof priority)
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <textarea
          className="mt-3 min-h-[88px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          placeholder="Describe the issue…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          className="mt-3"
          type="button"
          disabled={!subject.trim() || create.isPending}
          onClick={() =>
            create.mutate({
              subject: subject.trim(),
              body: body.trim() || undefined,
              priority,
              requesterType: "employee",
            })
          }
        >
          {create.isPending ? "Creating…" : "Create ticket"}
        </Button>
        {create.error ? (
          <p className="mt-2 text-sm text-red-700">{create.error.message}</p>
        ) : null}
      </section>

      <section className="rounded-xl border border-sand bg-white/75">
        <div className="border-b border-sand px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-muted">
          Open queue · {list.data?.length ?? 0}
        </div>
        {list.isLoading ? (
          <p className="p-6 text-sm text-muted">Loading tickets…</p>
        ) : (list.data?.length ?? 0) === 0 ? (
          <p className="p-6 text-sm text-muted">No tickets yet.</p>
        ) : (
          <ul className="divide-y divide-sand">
            {(list.data ?? []).map((t) => (
              <li key={t.ticketId} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{t.subject}</p>
                    <p className="mt-1 text-xs text-muted">
                      {t.status} · {t.priority} · updated {t.updatedAt.slice(0, 19)}
                    </p>
                  </div>
                  <span className="rounded-full bg-cream px-2 py-1 text-[10px] font-semibold uppercase text-muted">
                    {t.priority}
                  </span>
                </div>
                {t.body ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted">{t.body}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
