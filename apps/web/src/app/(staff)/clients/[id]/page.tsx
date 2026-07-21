"use client";

import Link from "next/link";
import { Button } from "@hrmny/ui";
import { trpc } from "@/lib/trpc";
import { useParams } from "next/navigation";
import { useState } from "react";

export default function ClientOnboardingPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const utils = trpc.useUtils();
  const client = trpc.clients.get.useQuery({ id });
  const onboarding = trpc.clients.onboarding.get.useQuery({ clientId: id });
  const immersion = trpc.clients.immersion.get.useQuery({ clientId: id });
  const signoff = trpc.clients.onboarding.signoff.useMutation({
    onSuccess: () => void utils.clients.invalidate(),
  });
  const upsert = trpc.clients.immersion.upsert.useMutation({
    onSuccess: () => void utils.clients.invalidate(),
  });

  const [usp, setUsp] = useState("");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("");

  return (
    <main className="flex flex-col gap-6">
      <div>
        <Link href="/sales" className="text-sm text-ochre underline">
          ← Sales
        </Link>
        <h1 className="font-display text-3xl font-semibold">
          {client.data?.name ?? "Client"}
        </h1>
        <p className="text-muted">
          Onboarding 7-phase · Immersion form · renewal{" "}
          {client.data && "renewalDate" in client.data
            ? String(client.data.renewalDate)
            : "—"}
        </p>
      </div>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Onboarding board</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {(onboarding.data ?? []).map((phase) => (
            <li
              key={phase.phaseId}
              className="border-t border-sand/60 pt-3 text-sm"
            >
              <p className="font-medium">
                P{phase.phaseIndex}: {phase.name}{" "}
                <span className="text-muted">({phase.status})</span>
              </p>
              <ul className="mt-1 text-xs text-muted">
                {phase.steps.map((s) => (
                  <li key={s.stepId}>
                    [{s.raci}] {s.title} {s.done ? "✓" : ""}
                  </li>
                ))}
              </ul>
              {phase.status === "active" ? (
                <Button
                  type="button"
                  className="mt-2"
                  onClick={() =>
                    void signoff.mutateAsync({
                      clientId: id,
                      phaseIndex: phase.phaseIndex,
                    })
                  }
                >
                  Sign off phase
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-sand bg-white/70 p-4">
        <h2 className="font-display text-lg">Immersion Form 3</h2>
        <div className="mt-3 flex max-w-lg flex-col gap-2 text-sm">
          <label>
            USP
            <input
              className="mt-1 w-full rounded border border-sand px-3 py-2"
              value={usp}
              onChange={(e) => setUsp(e.target.value)}
            />
          </label>
          <label>
            Audience
            <input
              className="mt-1 w-full rounded border border-sand px-3 py-2"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            />
          </label>
          <label>
            Objective priority
            <input
              className="mt-1 w-full rounded border border-sand px-3 py-2"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </label>
          <Button
            type="button"
            onClick={() =>
              void upsert.mutateAsync({
                clientId: id,
                usp,
                audience,
                objectivePriority: objective,
                swot: {
                  strengths: "Brand trust",
                  weaknesses: "Manual ops",
                  opportunities: "KSA",
                  threats: "Agency churn",
                },
                complete: true,
              })
            }
          >
            Save & complete immersion
          </Button>
        </div>
        <pre className="mt-3 overflow-x-auto text-xs">
          {JSON.stringify(immersion.data ?? [], null, 2)}
        </pre>
      </section>
    </main>
  );
}
