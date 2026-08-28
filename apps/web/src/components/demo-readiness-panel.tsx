"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  demoBlockerConnectionsPath,
  isOptionalLaterDemoBlocker,
  prioritizeDemoBlockers,
} from "@/lib/demo-blocker-anchor";
import { formatReadyLlmLine, type ReadySmoke } from "@/lib/ready-smoke";

/**
 * CRM hub strip: live-demo blockers, LLM runtime, and funnel entry links.
 */
export function DemoReadinessPanel({
  testIdPrefix = "crm",
}: {
  testIdPrefix?: string;
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

  const blockers = prioritizeDemoBlockers(ready.blockers ?? []);
  const required = blockers.filter((item) => !isOptionalLaterDemoBlocker(item));
  const later = blockers.filter((item) => isOptionalLaterDemoBlocker(item));

  return (
    <section
      className="mb-4 rounded-xl border border-sand bg-white/80 px-4 py-3 text-sm"
      data-testid={`${testIdPrefix}-demo-readiness`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
          Demo readiness
        </p>
        <p
          className="text-xs text-muted"
          data-testid={`${testIdPrefix}-demo-blockers-count`}
        >
          {required.length > 0
            ? `${required.length} required${
                later.length ? ` · ${later.length} later` : ""
              }`
            : later.length > 0
              ? `${later.length} optional later`
              : "Connection references ready"}
        </p>
      </div>
      <p className="mt-2 text-muted" data-testid={`${testIdPrefix}-demo-llm`}>
        LLM {formatReadyLlmLine(ready)}
      </p>
      {blockers.length > 0 ? (
        <ul
          className="mt-2 list-disc space-y-1 pl-5 text-muted"
          data-testid={`${testIdPrefix}-demo-blockers`}
        >
          {blockers.slice(0, 4).map((item) => {
            const href = demoBlockerConnectionsPath(item);
            return (
              <li key={item}>
                {href ? (
                  <Link href={href} className="underline text-ochre">
                    {item}
                  </Link>
                ) : (
                  item
                )}
              </li>
            );
          })}
          {blockers.length > 4 ? (
            <li className="text-xs">
              +{blockers.length - 4} more on{" "}
              <Link href="/settings/connections" className="underline">
                Connections
              </Link>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-2 text-muted" data-testid={`${testIdPrefix}-demo-clear`}>
          Configured references are ready for browser acceptance. Provider
          acceptance and destination readback remain separate checks.
        </p>
      )}
      <p className="mt-3 flex flex-wrap gap-3 text-xs">
        <Link href="/crm/hunt" className="underline font-medium text-ink">
          Sales Growth
        </Link>
        <Link href="/crm/inbound" className="underline">
          Inbound capture
        </Link>
        <Link
          href="/settings/connections"
          className="underline"
          data-testid={`${testIdPrefix}-demo-connections`}
        >
          Connections
        </Link>
        <Link href="/settings/ai" className="underline">
          AI agents
        </Link>
      </p>
    </section>
  );
}
