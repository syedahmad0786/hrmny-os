"use client";

import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { showDemoResets } from "@/lib/feature-flags";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const DOR_FIELDS = [
  "objective",
  "audience",
  "deliverables",
  "deadline",
  "brandAssets",
  "channels",
  "successMetric",
] as const;

function TrafficDorInner() {
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const clientIdFromQuery = searchParams.get("clientId")?.trim() || "";
  const briefIdFromQuery = searchParams.get("briefId")?.trim() || "";
  const ids = trpc.m4.seedIds.useQuery(
    clientIdFromQuery ? { clientId: clientIdFromQuery } : undefined,
  );
  const reset = trpc.m4.reset.useMutation({
    onSuccess: () => void utils.invalidate(),
  });
  // Prefer explicit briefId, then client-scoped seed, then bare demo seed.
  const briefId =
    briefIdFromQuery ||
    ids.data?.briefId ||
    (!clientIdFromQuery ? undefined : null);
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
  const [spawnedTaskId, setSpawnedTaskId] = useState<string | null>(null);

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
      setSpawnedTaskId(null);
      setLockMsg(result.reason);
    } else {
      setSpawnedTaskId(result.spawnedTaskId ?? null);
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

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        {clientIdFromQuery ? (
          <p className="mb-2 text-xs text-muted" data-testid="traffic-active-client">
            Active client {clientIdFromQuery.slice(0, 8)}…
          </p>
        ) : null}
        <p className="text-sm" data-testid="traffic-brief-id">
          Brief: <span className="font-mono text-xs">{briefId ?? "…"}</span>
        </p>
        <p className="mt-2 text-sm" data-testid="traffic-dor-missing">
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
            data-testid="traffic-save-validate"
            onClick={() => void saveBody(body)}
          >
            Save & validate DoR
          </Button>
          <Button
            type="button"
            data-testid="traffic-fill-lock"
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
          <Button
            type="button"
            variant="ghost"
            data-testid="traffic-try-lock"
            onClick={() => void tryLock()}
          >
            Try lock (expect block if &gt;2)
          </Button>
        </div>
        {lockMsg ? (
          <p className="mt-3 text-sm text-ink" data-testid="traffic-lock-status">
            {lockMsg}
          </p>
        ) : null}
        {spawnedTaskId ? (
          <div
            className="mt-3 rounded border border-sand bg-white/80 p-3 text-sm"
            data-testid="traffic-spawn-result"
          >
            <p>
              Spawned creative task{" "}
              <span className="font-mono text-xs">{spawnedTaskId}</span>
            </p>
            <Link
              className="mt-2 inline-block text-ochre underline"
              href={`/creative?taskId=${spawnedTaskId}`}
              data-testid="traffic-creative-task-link"
            >
              Open creative task
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default function TrafficDorPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-muted">Loading traffic…</main>}>
      <TrafficDorInner />
    </Suspense>
  );
}
