"use client";

import Link from "next/link";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";

const today = () => new Date().toISOString().slice(0, 10);

function AccountRhythmPageInner() {
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const session = trpc.auth.session.useQuery();
  const ids = trpc.m4.seedIds.useQuery();
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const fromQuery = searchParams.get("clientId")?.trim() || "";
  const clientId = fromQuery || ids.data?.clientId;
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
  const accessibilityEnabled =
    session.data?.enabledFeatureKeys.includes("work.accessibility") ?? false;
  const outOfOffice = trpc.work.outOfOffice.list.useQuery(undefined, {
    enabled: outOfOfficeEnabled,
    retry: false,
  });
  const accessibility = trpc.work.accessibility.get.useQuery(undefined, {
    enabled: accessibilityEnabled,
    retry: false,
  });
  const saveAccessibility = trpc.work.accessibility.update.useMutation({
    onSuccess: (preference) =>
      utils.work.accessibility.get.setData(undefined, preference),
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

  const cal =
    calendars.data?.find((c) => c.calendarId === calendarId) ??
    calendars.data?.[0];
  const activeCalendarId = cal?.calendarId ?? calendarId;

  async function tryLateShootChange() {
    if (!activeCalendarId) return;
    const next = new Date(Date.now() + 72 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = await shoot.mutateAsync({
      id: activeCalendarId,
      shootDate: next,
    });
    if (!result.ok) {
      setMsg(`T-48h BLOCKED: ${result.blockedBy?.[0]?.reason ?? "locked"}`);
    } else {
      setMsg(`Shoot updated (locked=${String(result.shootLock.locked)})`);
    }
  }

  async function forceEscalate() {
    if (!activeCalendarId || !cal?.shootDate) return;
    // Re-set same shoot date to evaluate T-24 escalate path
    const result = await shoot.mutateAsync({
      id: activeCalendarId,
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
          {clientId ? (
            <p className="mt-1 text-xs text-muted">
              Active client {clientId.slice(0, 8)}…
              {ids.data && "source" in ids.data && ids.data.source
                ? ` · ${ids.data.source.replaceAll("_", " ")}`
                : ""}
            </p>
          ) : null}
        </div>
        {showDemoResets() ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void reset.mutateAsync()}
          >
            Reset M4 demo
          </Button>
        ) : null}
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

      {accessibilityEnabled && accessibility.data ? (
        <section className="rounded-lg border border-sand bg-white/70 p-4">
          <h2 className="font-display text-lg">Display & accessibility</h2>
          <p className="mt-1 text-sm text-muted">
            Screen reader landmarks, keyboard focus, and skip navigation are
            active. Choose how the portal should look and move for you.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="grid gap-1 text-sm">
              Theme
              <select
                className="rounded-md border border-sand bg-white px-3 py-2"
                value={accessibility.data.theme}
                onChange={(event) =>
                  saveAccessibility.mutate({
                    ...accessibility.data!,
                    theme: event.target.value as "system" | "light" | "dark",
                  })
                }
              >
                <option value="system">Use device setting</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-md border border-sand px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={accessibility.data.colorblindMode}
                onChange={(event) =>
                  saveAccessibility.mutate({
                    ...accessibility.data!,
                    colorblindMode: event.target.checked,
                  })
                }
              />
              Colorblind-friendly palette
            </label>
            <label className="flex items-center gap-3 rounded-md border border-sand px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={accessibility.data.reducedMotion}
                onChange={(event) =>
                  saveAccessibility.mutate({
                    ...accessibility.data!,
                    reducedMotion: event.target.checked,
                  })
                }
              />
              Reduce motion
            </label>
          </div>
          {saveAccessibility.error ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {saveAccessibility.error.message}
            </p>
          ) : null}
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
        {cal && activeCalendarId ? (
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
                onClick={() =>
                  void refApprove.mutateAsync({ id: activeCalendarId })
                }
              >
                Ref-approve calendar
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  void shoot
                    .mutateAsync({
                      id: activeCalendarId,
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
          <p className="mt-2 text-muted">
            No content calendar for this client yet.{" "}
            <Link className="underline" href="/crm/hunt">
              Run demo closed loop on Hunt
            </Link>{" "}
            to seed one, or use Reset M4 demo when demo resets are enabled.
          </p>
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

export default function AccountRhythmPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-col gap-6">
          <h1 className="font-display text-3xl font-semibold">Account</h1>
          <p className="text-muted">Loading…</p>
        </main>
      }
    >
      <AccountRhythmPageInner />
    </Suspense>
  );
}
