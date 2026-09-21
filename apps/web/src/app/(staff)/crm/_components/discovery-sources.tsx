"use client";

import { useState } from "react";
import { CrmBtn, CrmEmpty, CrmTag } from "@/components/crm/ui";
import { trpc } from "@/lib/trpc";

function sourceKind(state: string) {
  if (state === "blocked" || state === "error") return "danger" as const;
  if (state === "candidate" || state === "unverified" || state === "manual")
    return "warn" as const;
  if (state === "verified" || state === "connected") return "success" as const;
  return "info" as const;
}

export function DiscoverySources() {
  const utils = trpc.useUtils();
  const access = trpc.salesOs.access.useQuery();
  const manifest = trpc.salesOs.discovery.manifest.useQuery();
  const programmes = trpc.salesOs.discovery.programmes.list.useQuery();
  const queue = trpc.salesOs.discovery.control.queue.useQuery();
  const [note, setNote] = useState<string | null>(null);
  const [policyProgrammeId, setPolicyProgrammeId] = useState("");
  const [policyCap, setPolicyCap] = useState("40");
  const reconnect = trpc.salesOs.discovery.control.reconnect.useMutation({
    onSuccess: (result) => {
      setNote(
        `Reconnected ${result.sourceKey.replaceAll("_", " ")} as generation ${result.credentialGeneration}. Collectors stay off.`,
      );
      void utils.salesOs.discovery.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const retry = trpc.salesOs.discovery.control.retry.useMutation({
    onSuccess: (result) => {
      setNote(
        `Retry queued for ${result.sourceKey.replaceAll("_", " ")} from checkpoint. No collector was started.`,
      );
      void utils.salesOs.discovery.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const proposePolicy = trpc.salesOs.discovery.control.proposePolicy.useMutation({
    onSuccess: () => {
      setNote(
        "Observation-cap suggestion queued. Accepting it records a new published version for later runs. Collectors stay off.",
      );
      void utils.salesOs.discovery.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const acceptPolicy = trpc.salesOs.discovery.control.acceptPolicy.useMutation({
    onSuccess: (result) => {
      setNote(
        `Accepted observation cap ${result.maxObservations} as published version ${result.publishedVersion ?? result.appliedVersion}. The next run consumes that version. Collectors stay off.`,
      );
      void utils.salesOs.discovery.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const canOperate = access.data?.canOperate === true;
  const canAdmin = access.data?.canAdmin === true;

  return (
    <section className="crm-panel mb-5" data-testid="discovery-sources">
      <div className="crm-panel-head">
        <div>
          <h3>Research sources</h3>
          <p>
            Required families stay visible even when blocked. A listed source is
            not an accepted collector.
          </p>
        </div>
      </div>
      <div className="crm-panel-body space-y-4">
        <p className="crm-note" data-testid="discovery-sources-status">
          <strong>Collector coverage: not accepted.</strong>{" "}
          {(programmes.data ?? []).filter((item) => item.blockedSourceCount > 0)
            .length}{" "}
          programme
          {(programmes.data ?? []).filter((item) => item.blockedSourceCount > 0)
            .length === 1
            ? ""
            : "s"}{" "}
          currently show source blockers.
        </p>
        <div data-testid="discovery-control-queue">
          <p data-testid="discovery-control-health">
            Action queue: {queue.data?.items.length ?? 0} · retryable{" "}
            {queue.data?.health.retryableFailures ?? 0} · reconnect{" "}
            {queue.data?.health.reconnects ?? 0} · policy{" "}
            {queue.data?.health.policySuggestions ?? 0}. Collectors stay off.
          </p>
          {canOperate && (programmes.data ?? []).length ? (
            <form
              className="crm-field"
              data-testid="discovery-policy-propose"
              onSubmit={(event) => {
                event.preventDefault();
                const programmeId =
                  policyProgrammeId || programmes.data?.[0]?.id;
                if (!programmeId) return;
                proposePolicy.mutate({
                  programmeId,
                  maxObservations: Number(policyCap),
                  reason:
                    "Operator proposed a structured observation-cap change for later runs",
                });
              }}
            >
              <label>
                Programme for observation-cap suggestion
                <select
                  className="crm-select"
                  data-testid="discovery-policy-programme"
                  value={policyProgrammeId || programmes.data?.[0]?.id || ""}
                  onChange={(event) => setPolicyProgrammeId(event.target.value)}
                >
                  {(programmes.data ?? []).map((programme) => (
                    <option key={programme.id} value={programme.id}>
                      {programme.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Suggested observation cap
                <input
                  className="crm-input"
                  data-testid="discovery-policy-cap"
                  max={200}
                  min={1}
                  type="number"
                  value={policyCap}
                  onChange={(event) => setPolicyCap(event.target.value)}
                />
              </label>
              <CrmBtn
                data-testid="discovery-policy-propose-submit"
                disabled={proposePolicy.isPending}
                type="submit"
              >
                Propose observation cap
              </CrmBtn>
            </form>
          ) : null}
          {note ? (
            <p className="crm-note" data-testid="discovery-control-note" role="status">
              {note}
            </p>
          ) : null}
          {(queue.data?.items ?? []).length ? (
            <ul className="space-y-2">
              {queue.data?.items.map((item) => (
                <li
                  key={item.id}
                  className="crm-approval-mini"
                  data-testid={`discovery-control-item-${item.kind}-${item.sourceKey}`}
                >
                  <strong>{item.title}</strong>
                  <p>{item.reason}</p>
                  {canOperate && item.kind === "source_reconnect" ? (
                    <CrmBtn
                      data-testid={`discovery-control-reconnect-${item.sourceKey}`}
                      disabled={reconnect.isPending}
                      onClick={() =>
                        reconnect.mutate({
                          programmeId: item.programmeId,
                          sourceKey: item.sourceKey,
                          reason:
                            "Operator reconnected the source without starting collectors",
                        })
                      }
                    >
                      Reconnect
                    </CrmBtn>
                  ) : null}
                  {canOperate && item.kind === "source_retry" && item.runId ? (
                    <CrmBtn
                      data-testid={`discovery-control-retry-${item.sourceKey}`}
                      disabled={retry.isPending}
                      onClick={() =>
                        retry.mutate({
                          runId: item.runId ?? "",
                          sourceKey: item.sourceKey,
                          requestId: crypto.randomUUID(),
                        })
                      }
                    >
                      Retry from checkpoint
                    </CrmBtn>
                  ) : null}
                  {canAdmin && item.kind === "policy_suggestion" ? (
                    <CrmBtn
                      data-testid={`discovery-control-accept-policy-${item.id}`}
                      disabled={acceptPolicy.isPending}
                      onClick={() =>
                        acceptPolicy.mutate({ suggestionId: item.id })
                      }
                    >
                      Accept for later runs
                    </CrmBtn>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <CrmEmpty title="No Discovery recovery actions" />
          )}
        </div>
        {manifest.error ? <p role="alert">{manifest.error.message}</p> : null}
        {!manifest.data ? (
          <CrmEmpty title="Loading the reviewed source manifest" />
        ) : (
          <div className="crm-approval-stack">
            {manifest.data.sources.map((source) => (
              <article
                key={source.sourceKey}
                className="crm-approval-mini"
                data-testid={`discovery-source-status-${source.sourceKey}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong>{source.displayName}</strong>
                  <CrmTag kind={sourceKind(source.capabilityState)}>
                    {source.capabilityState}
                  </CrmTag>
                </div>
                <p>
                  {source.family} · {source.required ? "Required" : "Optional"} ·{" "}
                  {source.connectionState.replaceAll("_", " ")}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {source.statusReason}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
