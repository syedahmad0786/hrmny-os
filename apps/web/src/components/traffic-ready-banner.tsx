"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatReadyDbLine, type ReadySmoke } from "@/lib/ready-smoke";

/** Brief DoR → creative spawn readiness from `/api/ready`. */
export function TrafficReadyBanner() {
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

  const dbUp = ready.database === "up";

  return (
    <div
      className="rounded-xl border border-sand bg-white/80 px-4 py-3 text-sm text-muted"
      role="status"
      data-testid="traffic-ready-banner"
    >
      <p data-testid="traffic-ready-db">
        {formatReadyDbLine(ready)}
        {dbUp
          ? " — brief lock + spawned creative tasks persist in Postgres."
          : " — memory mode: brief lock works for demo but resets without DATABASE_URL."}
      </p>
      <p className="mt-1">
        Lock with ≤2 DoR gaps missing spawns a creative task — open{" "}
        <Link href="/creative" className="underline">Creative</Link> after lock.
      </p>
    </div>
  );
}
