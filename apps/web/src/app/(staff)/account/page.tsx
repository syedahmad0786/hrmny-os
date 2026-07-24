"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { type FormEvent, useState } from "react";

const today = () => new Date().toISOString().slice(0, 10);

export default function AccountRhythmPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
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
  const [outOfOfficeId, setOutOfOfficeId] = useState<string | null>(null);
  const [awayStart, setAwayStart] = useState(today);
  const [awayEnd, setAwayEnd] = useState(today);
  const [awayNote, setAwayNote] = useState("");

  const outOfOfficeEnabled =
    session.data?.enabledFeatureKeys.includes("work.out_of_office") ?? false;
  const outOfOffice = trpc.work.outOfOffice.list.useQuery(undefined, {
    enabled: outOfOfficeEnabled,
    retry: false,
  });
  const clearAwayForm = () => {
    setOutOfOfficeId(null);
    setAwayStart(today());
    setAwayEnd(today());
    setAwayNote("");
  };
  const createAway = trpc.work.outOfOffice.create.useMutation({
    onSuccess: async () => {
      clearAwayForm();
      await Promise.all([
        utils.work.outOfOffice.list.invalidate(),
        utils.work.members.listEmployees.invalidate(),
      ]);
    },
  });
  const updateAway = trpc.work.outOfOffice.update.useMutation({
    onSuccess: async () => {
      clearAwayForm();
      await Promise.all([
        utils.work.outOfOffice.list.invalidate(),
        utils.work.members.listEmployees.invalidate(),
      ]);
    },
  });
  const removeAway = trpc.work.outOfOffice.remove.useMutation({
    onSuccess: async () => {
      clearAwayForm();
      await Promise.all([
        utils.work.outOfOffice.list.invalidate(),
        utils.work.members.listEmployees.invalidate(),
      ]);
    },
  });

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
      setMsg(`T-48h BLOCKED: ${result.blockedBy?.[0]?.reason ?? "locked"}`);
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

  function saveAway(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = { startDate: awayStart, endDate: awayEnd, note: awayNote };
    if (outOfOfficeId)
      void updateAway.mutateAsync({ outOfOfficeId, ...values });
    else void createAway.mutateAsync(values);
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Account</h1>
          <p className="text-muted">
            Availability, Month-1 rhythm, and calendar controls
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

      {outOfOfficeEnabled ? (
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-display text-lg">Out of office</h2>
          <p className="mt-1 text-sm text-muted">
            Add one or more away periods. Active dates appear beside your name
            when work is assigned.
          </p>
          <form
            className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end"
            onSubmit={saveAway}
          >
            <label className="grid gap-1 text-sm">
              Start date
              <input
                className="rounded-md border border-sand bg-white px-3 py-2"
                type="date"
                required
                value={awayStart}
                onChange={(event) => setAwayStart(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              End date
              <input
                className="rounded-md border border-sand bg-white px-3 py-2"
                type="date"
                required
                min={awayStart}
                value={awayEnd}
                onChange={(event) => setAwayEnd(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Note (optional)
              <input
                className="rounded-md border border-sand bg-white px-3 py-2"
                maxLength={500}
                placeholder="Back on Monday"
                value={awayNote}
                onChange={(event) => setAwayNote(event.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={createAway.isPending || updateAway.isPending}
              >
                {outOfOfficeId ? "Save" : "Add"}
              </Button>
              {outOfOfficeId ? (
                <Button type="button" variant="ghost" onClick={clearAwayForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
          {createAway.error || updateAway.error || removeAway.error ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {
                (createAway.error ?? updateAway.error ?? removeAway.error)
                  ?.message
              }
            </p>
          ) : null}
          <ul className="mt-4 grid gap-2">
            {(outOfOffice.data ?? []).map((period) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sand/70 px-3 py-2 text-sm"
                key={period.outOfOfficeId}
              >
                <span>
                  {period.startDate} – {period.endDate}
                  {period.note ? ` · ${period.note}` : ""}{" "}
                  <span className="text-muted">({period.status})</span>
                </span>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setOutOfOfficeId(period.outOfOfficeId);
                      setAwayStart(period.startDate);
                      setAwayEnd(period.endDate);
                      setAwayNote(period.note);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={removeAway.isPending}
                    onClick={() =>
                      void removeAway.mutateAsync({
                        outOfOfficeId: period.outOfOfficeId,
                      })
                    }
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Month-1 phases</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {(month1.data ?? []).map((p) => (
            <li
              key={p.phaseIndex}
              className="flex items-center justify-between"
            >
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => void forceEscalate()}
              >
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
                  void shoot
                    .mutateAsync({
                      id: calendarId!,
                      shootDate: new Date(Date.now() + 96 * 60 * 60 * 1000)
                        .toISOString()
                        .slice(0, 10),
                      rescheduleEdge: true,
                    })
                    .then((r) =>
                      setMsg(
                        r.ok
                          ? "Reschedule edge allowed"
                          : (r.blockedBy?.[0]?.reason ?? "blocked"),
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
