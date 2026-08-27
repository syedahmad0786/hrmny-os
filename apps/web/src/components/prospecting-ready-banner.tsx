"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReadySmoke } from "@/lib/ready-smoke";

/** Apollo tool mode from `/api/ready` for prospecting surfaces. Hunter is retired. */
export function ProspectingReadyBanner({
  testIdPrefix = "inbound",
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

  const apollo = ready.tools?.apollo ?? "—";
  const apolloLive = apollo !== "mock";

  return (
    <div
      className="rounded-xl border border-sand bg-white/80 px-4 py-3 text-sm text-muted"
      role="status"
      data-testid={`${testIdPrefix}-ready-banner`}
    >
      <p data-testid={`${testIdPrefix}-ready-apollo`}>
        Apollo: {apollo}
        {apolloLive
          ? " — live prospect import available on Hunt."
          : " — mock without API key; paste key in "}
        {!apolloLive ? (
          <Link href="/settings/connections#conn-apollo" className="underline">
            Connections
          </Link>
        ) : null}
        {!apolloLive ? "." : null}
      </p>
      <p className="mt-1" data-testid={`${testIdPrefix}-ready-hunter`}>
        Hunter is retired and is not required for Hunt or email verify.
      </p>
      <p className="mt-1 text-xs">
        Manual inbound capture below always creates a discover-stage deal in OS.
      </p>
    </div>
  );
}
