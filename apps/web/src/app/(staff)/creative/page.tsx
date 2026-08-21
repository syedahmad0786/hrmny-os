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
  const sendToPortal = trpc.creativeGen.sendToPortal.useMutation({
    onSuccess: (data) => {
      void utils.creativeGen.list.invalidate();
      void utils.tasks.invalidate();
      setMsg(
        data.ok
          ? `Sent to portal asset ${data.assetId.slice(0, 8)}… → ${data.portalHref}`
          : "Send failed",
      );
    },
  });
  const clients = trpc.clients.list.useQuery(undefined, { staleTime: 60_000 });
  const canvaDesigns = trpc.connections.canvaListDesigns.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  const canvaAttach = trpc.connections.canvaAttachToPortal.useMutation({
    onSuccess: (data) => {
      setMsg(
        data.ok
          ? `Canva → portal asset ${data.assetId.slice(0, 8)}… (${data.mode}) → ${data.portalHref}`
          : "Canva attach failed",
      );
    },
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(
    "Ochre and sand brand moodboard — soft studio light, editorial product still life",
  );
  const [portalClientId, setPortalClientId] = useState("");

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
              clientId: portalClientId || undefined,
            })
          }
        >
          {generate.isPending ? "Generating…" : "Generate image"}
        </Button>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted" htmlFor="portal-client">
            Portal client
          </label>
          <select
            id="portal-client"
            className="rounded-lg border border-sand bg-white px-2 py-1.5 text-sm"
            value={portalClientId}
            onChange={(e) => setPortalClientId(e.target.value)}
          >
            <option value="">Select client…</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.clientId} value={c.clientId}>
                {c.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            disabled={
              sendToPortal.isPending ||
              !portalClientId ||
              !generate.data?.creativeGenerationId ||
              generate.data.status !== "ready"
            }
            onClick={() => {
              if (!generate.data?.creativeGenerationId || !portalClientId) return;
              sendToPortal.mutate({
                creativeGenerationId: generate.data.creativeGenerationId,
                clientId: portalClientId,
              });
            }}
          >
            {sendToPortal.isPending ? "Sending…" : "Attach & send to portal"}
          </Button>
        </div>
        {sendToPortal.error ? (
          <p className="mt-2 text-red-700">{sendToPortal.error.message}</p>
        ) : null}
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
                  <button
                    type="button"
                    className="mt-1 text-[11px] underline disabled:opacity-40"
                    disabled={!portalClientId || sendToPortal.isPending}
                    onClick={() => {
                      if (!portalClientId) return;
                      sendToPortal.mutate({
                        creativeGenerationId: g.creativeGenerationId,
                        clientId: portalClientId,
                      });
                    }}
                  >
                    Send to portal
                  </button>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4 text-sm">
        <h2 className="font-display text-lg font-semibold">Canva → portal</h2>
        <p className="mt-1 text-muted">
          List connected Canva designs, export PNG into DAM, and open
          client_review on the portal.
        </p>
        {!canvaDesigns.data?.ok ? (
          <p className="mt-3 text-muted">
            {canvaDesigns.data?.reason ??
              (canvaDesigns.isLoading
                ? "Loading Canva designs…"
                : "Connect Canva under Settings → Connections")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {canvaDesigns.data.designs.map((design) => (
              <li
                key={design.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-sand/60 pb-2"
              >
                <span className="min-w-0 flex-1 truncate">{design.title}</span>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!portalClientId || canvaAttach.isPending}
                  onClick={() => {
                    if (!portalClientId) return;
                    canvaAttach.mutate({
                      designId: design.id,
                      clientId: portalClientId,
                      title: design.title,
                    });
                  }}
                >
                  {canvaAttach.isPending ? "Exporting…" : "Attach to portal"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {canvaAttach.error ? (
          <p className="mt-2 text-red-700">{canvaAttach.error.message}</p>
        ) : null}
        {canvaDesigns.error ? (
          <p className="mt-2 text-red-700">{canvaDesigns.error.message}</p>
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
