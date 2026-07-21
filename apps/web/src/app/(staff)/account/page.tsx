"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function AccountRhythmPage() {
  const utils = trpc.useUtils();
  const ids = trpc.m4.seedIds.useQuery();
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const clientId = ids.data?.clientId;
  const calendarId = ids.data?.calendarId;

  const month1 = trpc.clients.month1.get.useQuery(
    { clientId: clientId! },
    { enabled: Boolean(clientId) },
  );
  const calendars = trpc.calendars.listByClient.useQuery(
    { clientId: clientId! },
    { enabled: Boolean(clientId) },
  );
  const escalate = trpc.calendars.escalations.useQuery();
  const advance = trpc.clients.month1.transition.useMutation({
    onSuccess: () => void utils.clients.month1.invalidate(),
  });
  const shoot = trpc.calendars.shoot.useMutation({
    onSuccess: () => void utils.calendars.invalidate(),
  });
  const refApprove = trpc.calendars.refApprove.useMutation({
    onSuccess: () => void utils.calendars.invalidate(),
  });
  const [msg, setMsg] = useState<string | null>(null);

  const cal = calendars.data?.[0];

  async function tryLateShootChange() {
    if (!calendarId) return;
    const next = new Date(Date.now() + 72 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = await shoot.mutateAsync({
      id: calendarId,
      shootDate: next,
    });
    if (!result.ok) {
      setMsg(
        `T-48h BLOCKED: ${result.blockedBy?.[0]?.reason ?? "locked"}`,
      );
    } else {
      setMsg(`Shoot updated (locked=${String(result.shootLock.locked)})`);
    }
  }

  async function forceEscalate() {
    if (!calendarId || !cal?.shootDate) return;
    // Re-set same shoot date to evaluate T-24 escalate path
    const result = await shoot.mutateAsync({
      id: calendarId,
      shootDate: cal.shootDate,
    });
    if (result.ok) {
      setMsg(
        result.shootLock.escalateT24
          ? `T-24h escalate armed — ${result.escalations[0]?.message ?? "ok"}`
          : `Lock status: locked=${result.shootLock.locked}, escalate=${result.shootLock.escalateT24}`,
      );
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            Account rhythm
          </h1>
          <p className="text-muted">
            Month-1 P0–P6 · calendar · T-48h shoot lock
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void reset.mutateAsync()}
        >
          Reset M4 demo
        </Button>
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Month-1 phases</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {(month1.data ?? []).map((p) => (
            <li key={p.phaseIndex} className="flex items-center justify-between">
              <span>
                P{p.phaseIndex}: {p.name}{" "}
                <span className="text-muted">({p.status})</span>
              </span>
              {p.status === "active" && p.phaseIndex < 6 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    void advance.mutateAsync({
                      clientId: clientId!,
                      toPhase: p.phaseIndex + 1,
                    })
                  }
                >
                  Advance
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
        <h2 className="font-display text-lg">Calendar / shoot gate</h2>
        {cal ? (
          <>
            <p className="mt-2">
              {cal.month} · shoot {cal.shootDate ?? "—"} · state {cal.state} ·
              ref {cal.refApprovalState ?? "—"}
            </p>
            <p className="text-muted">
              T-48h locked={String(cal.shootLock.locked)} · T-24 escalate=
              {String(cal.shootLock.escalateT24)}
              {cal.shootLock.reason ? ` — ${cal.shootLock.reason}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void tryLateShootChange()}
              >
                Change shoot (expect T-48h block)
              </Button>
              <Button type="button" variant="ghost" onClick={() => void forceEscalate()}>
                Re-eval shoot / T-24 escalate
              </Button>
              <Button
                type="button"
                onClick={() => void refApprove.mutateAsync({ id: calendarId! })}
              >
                Ref-approve calendar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  void shoot.mutateAsync({
                    id: calendarId!,
                    shootDate: new Date(Date.now() + 96 * 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 10),
                    rescheduleEdge: true,
                  }).then((r) =>
                    setMsg(
                      r.ok
                        ? "Reschedule edge allowed"
                        : r.blockedBy?.[0]?.reason ?? "blocked",
                    ),
                  )
                }
              >
                Reschedule edge
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-muted">Reset M4 demo to seed calendar.</p>
        )}
        {msg ? <p className="mt-3 text-ink">{msg}</p> : null}
        {(escalate.data ?? []).length > 0 ? (
          <ul className="mt-3 text-xs text-muted">
            {escalate.data!.slice(0, 5).map((e) => (
              <li key={e.id}>
                [{e.kind}] {e.message}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
