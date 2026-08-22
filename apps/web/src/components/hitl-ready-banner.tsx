"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReadySmoke } from "@/lib/ready-smoke";

/**
 * GW / LinkedIn / Resend readiness for HITL surfaces (Approvals, Outreach).
 * testIdPrefix keeps e2e ids stable per page (e.g. approvals-ready-gw).
 */
export function HitlReadyBanner({
  testIdPrefix,
}: {
  testIdPrefix: "approvals" | "outreach";
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
    <div
      className="rounded-xl border border-sand bg-white/80 px-4 py-3 text-sm text-muted"
      role="status"
      data-testid={`${testIdPrefix}-ready-banner`}
    >
      <p data-testid={`${testIdPrefix}-ready-gw`}>
        {(ready.connections?.googleWorkspace ?? 0) < 1 ? (
          <>
            {(ready.connections?.errors?.googleWorkspace ?? 0) > 0
              ? "Gmail HITL Approve & send is blocked until Google Workspace is reconnected (token revoked)."
              : "Gmail HITL Approve & send is blocked until Google Workspace is connected."}{" "}
            <Link href="/settings/connections" className="underline">
              Reconnect in Connections
            </Link>
          </>
        ) : (
          "Google Workspace connected — outreach Approve & send can go live."
        )}
      </p>
      <p className="mt-1" data-testid={`${testIdPrefix}-ready-linkedin`}>
        {(ready.connections?.linkedin ?? 0) < 1 ? (
          <>
            LinkedIn is not connected — campaign publish still completes in OS
            as stub (not a live social post).{" "}
            <Link href="/settings/connections" className="underline">
              Connect LinkedIn for live
            </Link>
          </>
        ) : (
          "LinkedIn connected — campaign publish can go live."
        )}
      </p>
      {ready.tools?.resend && ready.tools.resend !== "live" ? (
        <p className="mt-1" data-testid={`${testIdPrefix}-ready-resend`}>
          Portal invite email is mock until Resend is live —{" "}
          <Link href="/settings/connections" className="underline">
            configure Resend
          </Link>
          .
        </p>
      ) : ready.tools?.resend === "live" ? (
        <p className="mt-1" data-testid={`${testIdPrefix}-ready-resend`}>
          Resend live — portal invite email can send.
        </p>
      ) : null}
    </div>
  );
}
