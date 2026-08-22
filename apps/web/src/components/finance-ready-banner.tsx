"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReadySmoke } from "@/lib/ready-smoke";

/** Xero OAuth + write policy from `/api/ready` for the Finance queue. */
export function FinanceReadyBanner() {
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

  const xeroTool = ready.tools?.xero ?? "—";
  const xeroConnected = (ready.connections?.xero ?? 0) > 0;
  const xeroLive = xeroTool !== "mock" && xeroConnected;

  return (
    <div
      className="rounded-xl border border-sand bg-white/80 px-4 py-3 text-sm text-muted"
      role="status"
      data-testid="finance-ready-banner"
    >
      <p data-testid="finance-ready-xero">
        {xeroLive ? (
          <>
            Xero OAuth connected (tool {xeroTool}) — OS can mirror invoices from
            Xero.
          </>
        ) : (
          <>
            Xero is {xeroTool === "mock" ? "mock" : xeroTool} with{" "}
            {ready.connections?.xero ?? 0} connected account(s) — Mark issued
            stays OS-only until{" "}
            <Link href="/settings/connections#conn-xero" className="underline">
              Connect Xero OAuth
            </Link>
            .
          </>
        )}
      </p>
      <p className="mt-1" data-testid="finance-ready-write">
        {ready.xeroWriteEnabled
          ? "XERO_WRITE_ENABLED is on — live Xero invoice writes may be allowed for ops."
          : "Xero write disabled — Mark issued records in OS only (xero mirror id stays —)."}
      </p>
    </div>
  );
}
