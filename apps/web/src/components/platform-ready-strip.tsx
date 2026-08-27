"use client";

import { useEffect, useState } from "react";
import {
  formatReadyDbLine,
  formatReadyLlmLine,
  formatReadyToolsLine,
  type ReadySmoke,
} from "@/lib/ready-smoke";

/** Lightweight `/api/ready` strip for Connections and other staff setup surfaces. */
export function PlatformReadyStrip({
  testId = "platform-ready-strip",
  showTools = false,
}: {
  testId?: string;
  /** Show n8n/apollo/openrouter/resend modes from /api/ready.tools */
  showTools?: boolean;
}) {
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

  return (
    <section
      className="rounded-lg border border-sand bg-white/75 p-4 text-sm"
      data-testid={testId}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
        Platform readiness
      </p>
      <p className="mt-2 text-muted" data-testid={`${testId}-llm`}>
        LLM {formatReadyLlmLine(ready)}
      </p>
      <p className="mt-1 text-muted" data-testid={`${testId}-db`}>
        {formatReadyDbLine(ready)}
      </p>
      {ready.connectedAppPolicy ? (
        <p className="mt-1 text-muted" data-testid={`${testId}-app-policy`}>
          Connected-app policy {ready.connectedAppPolicy.replaceAll("_", " ")}
          {ready.connectedAppPolicy === "disabled"
            ? " · first-party CRM stays open"
            : ""}
        </p>
      ) : null}
      {showTools ? (
        <p className="mt-1 text-muted" data-testid={`${testId}-tools`}>
          Tools {formatReadyToolsLine(ready)}
        </p>
      ) : null}
    </section>
  );
}
