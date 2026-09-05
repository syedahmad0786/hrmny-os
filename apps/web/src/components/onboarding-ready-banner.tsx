"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReadySmoke } from "@/lib/ready-smoke";

/** Portal magic-link + Resend status for onboarding / account surfaces. */
export function OnboardingReadyBanner({
  testIdPrefix,
}: {
  testIdPrefix: "account" | "client-onboarding" | "delivery" | "clients";
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
      className="rounded-xl border border-sand px-4 py-3 text-sm text-muted"
      role="status"
      data-testid={`${testIdPrefix}-ready-banner`}
    >
      <p data-testid={`${testIdPrefix}-ready-portal`}>
        {magic === "enabled"
          ? "Client portal access links are available for authorized contacts."
          : "Client portal sign-in is not ready. Configure portal access before inviting clients."}
      </p>
      <p className="mt-1" data-testid={`${testIdPrefix}-ready-resend`}>
        {resend === "live"
          ? "Portal invitation emails are enabled."
          : "Portal invitation emails are not enabled. Access links are shown for staff review; no invitation email is sent."}{" "}
        {resend !== "live" ? (
          <Link
            href="/settings/connections"
            className="inline-flex min-h-11 items-center underline"
          >
            Configure invitation email
          </Link>
        ) : null}
      </p>
    </div>
  );
}
