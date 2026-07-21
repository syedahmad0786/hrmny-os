"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";

const DOR_FIELDS = [
  "objective",
  "audience",
  "deliverables",
  "deadline",
  "brandAssets",
  "channels",
  "successMetric",
] as const;

export default function TrafficDorPage() {
  const utils = trpc.useUtils();
  const ids = trpc.m4.seedIds.useQuery();
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const briefId = ids.data?.briefId;
  const brief = trpc.briefs.get.useQuery(
    { id: briefId! },
    { enabled: Boolean(briefId) },
  );
  const validate = trpc.briefs.validateDor.useMutation({
    onSuccess: () => void utils.briefs.invalidate(),
  });
  const lock = trpc.briefs.lock.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  const update = trpc.briefs.updateBody.useMutation({
    onSuccess: () => void utils.briefs.invalidate(),
  });

  const [body, setBody] = useState<Record<string, string>>({});
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  useEffect(() => {
    if (brief.data?.body) {
      const next: Record<string, string> = {};
      for (const k of DOR_FIELDS) {
        const v = brief.data.body[k];
        next[k] =
          typeof v === "string"
            ? v
            : v
              ? JSON.stringify(v)
              : "";
      }
      setBody(next);
    }
  }, [brief.data]);

  async function saveBody(filled: Record<string, string>) {
    if (!briefId) return;
    const parsed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(filled)) {
      if (!v.trim()) continue;
      if (k === "brandAssets") {
        parsed[k] = { note: v };
      } else {
        parsed[k] = v;
      }
    }
    await update.mutateAsync({ id: briefId, body: parsed });
    await validate.mutateAsync({ id: briefId });
  }

  async function tryLock() {
    if (!briefId) return;
    const result = await lock.mutateAsync({ id: briefId });
    if (!result.ok) {
      setLockMsg(result.reason);
    } else {
      setLockMsg(`Locked → taskStatus=${result.taskStatus}`);
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            Traffic · Definition of Ready
          </h1>
          <p className="text-muted">
            Form 2 — lock blocked when &gt;2 required items missing
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
        <p className="text-sm">
          Missing:{" "}
          <strong>{brief.data?.missingRequiredCount ?? "—"}</strong>
          {brief.data?.missing?.length
            ? ` (${brief.data.missing.join(", ")})`
            : ""}
          {brief.data?.lockedAt ? (
            <span className="ml-2 text-ochre">· locked</span>
          ) : null}
        </p>
        <div className="mt-4 grid max-w-xl gap-2 text-sm">
          {DOR_FIELDS.map((field) => (
            <label key={field} className="flex flex-col gap-1">
              <span className="text-muted">{field}</span>
              <input
                className="rounded border border-sand px-3 py-2"
                value={body[field] ?? ""}
                onChange={(e) =>
                  setBody((prev) => ({ ...prev, [field]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void saveBody(body)}
          >
            Save & validate DoR
          </Button>
          <Button
            type="button"
            onClick={() =>
              void saveBody({
                objective: "Grow retail",
                audience: "UAE shoppers",
                deliverables: "3 reels",
                deadline: "2026-09-30",
                brandAssets: "logo pack",
                channels: "",
                successMetric: "",
              }).then(() => tryLock())
            }
          >
            Fill ≤2 missing & lock
          </Button>
          <Button type="button" variant="ghost" onClick={() => void tryLock()}>
            Try lock (expect block if &gt;2)
          </Button>
        </div>
        {lockMsg ? <p className="mt-3 text-sm text-ink">{lockMsg}</p> : null}
      </section>
    </main>
  );
}
