"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReadySmoke } from "@/lib/ready-smoke";

/** Portal magic-link + Resend status for onboarding / account surfaces. */
export function OnboardingReadyBanner({
  testIdPrefix,
}: {
  testIdPrefix: "account" | "client-onboarding" | "delivery";
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

  const magic = ready.portalMagicLink ?? "—";
  const resend = ready.tools?.resend ?? "—";

  return (
    <div
      className="rounded-xl border border-sand bg-white/80 px-4 py-3 text-sm text-muted"
      role="status"
      data-testid={`${testIdPrefix}-ready-banner`}
    >
      <p data-testid={`${testIdPrefix}-ready-portal`}>
        Portal magic-link: {magic}
        {magic === "enabled"
          ? " — staff mint links open portal approvals/onboarding."
          : " — portal login may require dev role until magic-link is enabled."}
      </p>
      <p className="mt-1" data-testid={`${testIdPrefix}-ready-resend`}>
        {resend === "live"
          ? "Resend live — portal invite and onboarding emails can send."
          : resend === "configured"
            ? "Resend key present — set RESEND_MODE=live for real portal email."
            : "Resend mock — portal invites show magic links in UI without email."}{" "}
        {resend !== "live" ? (
          <Link href="/settings/connections" className="underline">
            Configure Resend
          </Link>
        ) : null}
      </p>
    </div>
  );
}
