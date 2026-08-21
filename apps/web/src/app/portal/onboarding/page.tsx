"use client";

import { trpc } from "@/lib/trpc";

export default function PortalOnboardingPage() {
  const utils = trpc.useUtils();
  const data = trpc.portal.onboarding.get.useQuery();
  const ack = trpc.portal.onboarding.acknowledge.useMutation({
    onSuccess: () => void utils.portal.onboarding.get.invalidate(),
  });

  return (
    <main className="flex flex-col gap-6" data-testid="portal-onboarding">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">
          Onboarding
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          Track kickoff through steady-state. Acknowledge the active phase when
          your side is complete — no finance fields here.
        </p>
      </div>

      {data.error ? (
        <p className="text-sm text-muted">{data.error.message}</p>
      ) : null}

      <ol className="space-y-4" data-testid="portal-onboarding-list">
        {(data.data?.phases ?? []).map((phase) => (
          <li
            key={phase.phaseIndex}
            className="border-b border-sand pb-4 last:border-0"
            data-testid={`portal-onboarding-phase-${phase.phaseIndex}`}
            data-phase-status={phase.status}
            data-phase-name={phase.name}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg text-ink">
                {phase.phaseIndex + 1}. {phase.name}
              </h2>
              <span
                className="text-sm text-ochre"
                data-testid="portal-onboarding-phase-status"
              >
                {phase.status}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {phase.steps.map((step, i) => (
                <li key={`${phase.phaseIndex}-${i}`}>
                  {step.done ? "✓" : "○"} {step.title}
                </li>
              ))}
            </ul>
            {phase.status === "active" ? (
              <button
                type="button"
                data-testid="portal-onboarding-ack"
                className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
                disabled={ack.isPending}
                onClick={() => ack.mutate({ phaseIndex: phase.phaseIndex })}
              >
                {ack.isPending ? "Saving…" : "Acknowledge phase"}
              </button>
            ) : null}
            {phase.signedOffAt ? (
              <p className="mt-2 text-xs text-muted">
                Signed off {new Date(phase.signedOffAt).toLocaleString()}
              </p>
            ) : null}
          </li>
        ))}
        {!data.data?.phases?.length && !data.isLoading ? (
          <li className="text-sm text-muted">
            No onboarding phases yet — ask your account team after deal won /
            handover.
          </li>
        ) : null}
      </ol>
      {ack.error ? (
        <p className="text-sm text-red-700">{ack.error.message}</p>
      ) : null}
    </main>
  );
}
