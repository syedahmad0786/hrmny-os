"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatReadyLlmLine, type ReadySmoke } from "@/lib/ready-smoke";

/** Canva, DAM, and LLM readiness for Creative QC / gen / portal attach. */
export function CreativeReadyBanner() {
  const [ready, setReady] = useState<ReadySmoke | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ready")
      .then((r) => r.json())
      .then((body: ReadySmoke) => {
        if (!cancelled) setReady(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;

  const canvaConnected = (ready.connections?.canva ?? 0) > 0;
  const dam = ready.tools?.dam ?? "—";

  return (
    <div
      className="rounded-xl border border-sand bg-white/80 px-4 py-3 text-sm text-muted"
      role="status"
      data-testid="creative-ready-banner"
    >
      <p data-testid="creative-ready-canva">
        {canvaConnected ? (
          "Canva OAuth connected — live design list and export available."
        ) : (
          <>
            Canva not connected — stub list/attach works for demo.{" "}
            <Link href="/settings/connections#conn-canva" className="underline">
              Connect Canva
            </Link>
            .
          </>
        )}
      </p>
      <p className="mt-1" data-testid="creative-ready-dam">
        DAM storage: {dam} · portal attach writes client assets here.
      </p>
      <p className="mt-1" data-testid="creative-ready-llm">
        Image gen LLM {formatReadyLlmLine(ready)}
      </p>
    </div>
  );
}
