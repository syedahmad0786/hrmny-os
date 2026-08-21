"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import { useState } from "react";

export default function CreativeQcPage() {
  const utils = trpc.useUtils();
  const ids = trpc.m4.seedIds.useQuery();
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const taskId = ids.data?.creativeTaskId;
  const task = trpc.tasks.get.useQuery(
    { id: taskId! },
    { enabled: Boolean(taskId) },
  );
  const qc = trpc.tasks.qc.useMutation({
    onSuccess: () => void utils.tasks.invalidate(),
  });
  const transition = trpc.tasks.transition.useMutation({
    onSuccess: () => void utils.tasks.invalidate(),
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function tryClientFacing() {
    if (!taskId) return;
    const result = await transition.mutateAsync({
      id: taskId,
      to: "client_review",
      from: "qc",
    });
    if (!result.ok) {
      setMsg(
        `BLOCKED: ${result.blockedBy?.map((b) => b.gate).join(", ")} — ${result.blockedBy?.[0]?.reason}`,
      );
    } else {
      setMsg(`OK → ${result.newState}`);
    }
  }

  async function passThenAdvance() {
    if (!taskId) return;
    await qc.mutateAsync({ id: taskId, decision: "pass", notes: "CD approve" });
    const result = await transition.mutateAsync({
      id: taskId,
      to: "client_review",
      from: "qc",
      payload: { qcPassed: true },
    });
    setMsg(
      result.ok
        ? `QC passed → ${result.newState}`
        : `Still blocked: ${result.blockedBy?.[0]?.reason}`,
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Creative QC</h1>
          <p className="text-muted">
            State 5 (`qc`) — client-facing blocked until internal approve
          </p>
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

      <section className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
        <p>
          Task: <strong>{task.data?.title ?? "…"}</strong>
        </p>
        <p className="text-muted">
          status={task.data?.status ?? "—"} · qcPassed=
          {String(task.data?.qcPassed ?? false)}
        </p>
        <p className="mt-1 text-xs text-muted">
          Tip: switch Dev role to Creative Director before QC pass.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => void tryClientFacing()}>
            Advance to client_review (expect block)
          </Button>
          <Button type="button" onClick={() => void passThenAdvance()}>
            Pass QC → client_review
          </Button>
        </div>
        {msg ? <p className="mt-3 text-ink">{msg}</p> : null}
      </section>
    </main>
  );
}
