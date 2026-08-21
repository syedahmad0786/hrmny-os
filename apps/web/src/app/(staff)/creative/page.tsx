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
  const gens = trpc.creativeGen.list.useQuery({ limit: 8 });
  const generate = trpc.creativeGen.generate.useMutation({
    onSuccess: () => void utils.creativeGen.list.invalidate(),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(
    "Ochre and sand brand moodboard — soft studio light, editorial product still life",
  );

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
          <h1 className="font-display text-3xl font-semibold">Creative</h1>
          <p className="text-muted">
            QC gate plus OpenRouter image generation for creative tasks
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
        <h2 className="font-display text-lg font-semibold">Image generation</h2>
        <p className="mt-1 text-muted">
          Third-party LLM via OpenRouter (Gemini image / compatible). Mock SVG
          when keys or credits are unavailable.
        </p>
        <textarea
          className="mt-3 min-h-[80px] w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Button
          className="mt-3"
          type="button"
          disabled={generate.isPending || prompt.trim().length < 3}
          onClick={() =>
            generate.mutate({
              prompt: prompt.trim(),
            })
          }
        >
          {generate.isPending ? "Generating…" : "Generate image"}
        </Button>
        {generate.error ? (
          <p className="mt-2 text-red-700">{generate.error.message}</p>
        ) : null}
        {generate.data?.imageUrl ? (
          <div className="mt-4">
            <p className="text-xs text-muted">
              {generate.data.provider} · {generate.data.model}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={generate.data.imageUrl}
              alt="Generated creative"
              className="mt-2 max-h-80 rounded-lg border border-sand object-contain"
            />
          </div>
        ) : null}
        {(gens.data?.length ?? 0) > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(gens.data ?? []).map((g) =>
              g.imageUrl ? (
                <div key={g.creativeGenerationId} className="text-xs">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={g.imageUrl}
                    alt={g.prompt}
                    className="aspect-square w-full rounded-md border border-sand object-cover"
                  />
                  <p className="mt-1 line-clamp-2 text-muted">{g.prompt}</p>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
      </section>

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
          <Button
            type="button"
            variant="ghost"
            onClick={() => void tryClientFacing()}
          >
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
