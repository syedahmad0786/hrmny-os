"use client";

import { useState } from "react";
import { CrmBtn, CrmEmpty, CrmTag } from "@/components/crm/ui";
import { trpc } from "@/lib/trpc";

const formatDubai = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

function statusKind(status: string) {
  if (status === "failed" || status === "dead_letter") return "danger" as const;
  if (status === "cancelled" || status === "cancel_requested")
    return "warn" as const;
  if (status === "completed" || status === "partial") return "success" as const;
  return "info" as const;
}

export function DiscoveryRuns() {
  const utils = trpc.useUtils();
  const access = trpc.salesOs.access.useQuery();
  const programmes = trpc.salesOs.discovery.programmes.list.useQuery();
  const [programmeId, setProgrammeId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runs = trpc.salesOs.discovery.runs.list.useQuery({
    ...(programmeId ? { programmeId } : {}),
  });
  const selected = trpc.salesOs.discovery.runs.get.useQuery(
    { runId: selectedId ?? "" },
    { enabled: Boolean(selectedId) },
  );
  const cancel = trpc.salesOs.discovery.runs.cancel.useMutation({
    onSuccess: (run) => {
      setNote(
        `Run ${run.status === "cancel_requested" ? "will stop at the next safe boundary" : "cancelled"}. No collector was started.`,
      );
      void utils.salesOs.discovery.runs.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const requestRun = trpc.salesOs.discovery.programmes.requestRun.useMutation({
    onSuccess: (result) => {
      setSelectedId(result.runId);
      setNote(
        `Run ${result.status}. Collectors stay off until execution is enabled.`,
      );
      void utils.salesOs.discovery.runs.invalidate();
    },
    onError: (error) => setNote(error.message),
  });
  const selectedProgramme = (programmes.data ?? []).find(
    (programme) => programme.id === (programmeId || selected.data?.programmeId),
  );
  const canCancel =
    access.data?.canOperate === true &&
    (selected.data?.status === "pending" ||
      selected.data?.status === "deferred" ||
      selected.data?.status === "running");
  const canRequest =
    access.data?.canOperate === true &&
    selectedProgramme?.state === "active" &&
    selectedProgramme.executionEnabled === false;

  return (
    <section className="crm-panel mb-5" data-testid="discovery-runs">
      <div className="crm-panel-head flex-wrap justify-between gap-3">
        <div>
          <h3>Research runs</h3>
          <p>
            These rows are the armed or historical Discovery slots. Execution
            stays unavailable, so a queued run is not a source collection.
          </p>
        </div>
        <CrmBtn
          data-testid="discovery-request-run"
          disabled={!canRequest || requestRun.isPending || !selectedProgramme}
          onClick={() => {
            if (!selectedProgramme) return;
            requestRun.mutate({
              programmeId: selectedProgramme.id,
              expectedVersion: selectedProgramme.version,
              requestId: crypto.randomUUID(),
              overlap: "defer",
            });
          }}
        >
          Queue run now
        </CrmBtn>
      </div>
      <div className="crm-panel-body space-y-4">
        <label className="crm-field">
          Programme
          <select
            className="crm-select"
            data-testid="discovery-run-programme-filter"
            value={programmeId}
            onChange={(event) => {
              setProgrammeId(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="">All programmes I can see</option>
            {(programmes.data ?? []).map((programme) => (
              <option key={programme.id} value={programme.id}>
                {programme.name}
              </option>
            ))}
          </select>
        </label>
        <p className="crm-note" data-testid="discovery-runs-execution-status">
          <strong>Execution status: unavailable.</strong> Collectors and
          provider calls stay off. A pending slot is a schedule reservation
          only.
        </p>
        {note ? (
          <p className="crm-note" data-testid="discovery-run-note" role="status">
            {note}
          </p>
        ) : null}
        {runs.error ? <p role="alert">{runs.error.message}</p> : null}
        {(runs.data ?? []).length === 0 ? (
          <CrmEmpty
            title="No Discovery runs yet"
            hint="Publish a programme to arm the next Dubai slot. Queue run now replaces that pending slot without starting collection."
          />
        ) : (
          <div className="crm-approval-stack">
            {(runs.data ?? []).map((run) => (
              <button
                key={run.runId}
                type="button"
                className={`crm-approval-mini text-left ${selectedId === run.runId ? "is-focused" : ""}`}
                data-testid={`discovery-run-${run.runId}`}
                onClick={() => setSelectedId(run.runId)}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong>{run.programmeName}</strong>
                  <CrmTag kind={statusKind(run.status)}>{run.status}</CrmTag>
                </div>
                <p>
                  {run.trigger} · Due {formatDubai(run.runAt)} · Dispatch{" "}
                  {run.dispatchState}
                </p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {run.collectorStarted
                    ? "Collector receipt present"
                    : "Collector not started"}{" "}
                  · {run.sourceCount} source
                  {run.sourceCount === 1 ? "" : "s"}
                </p>
              </button>
            ))}
          </div>
        )}
        {selected.data ? (
          <article
            className="crm-approval-mini"
            data-testid="discovery-run-detail"
          >
            <div className="flex items-center justify-between gap-2">
              <strong>Run detail</strong>
              <CrmTag kind={statusKind(selected.data.status)}>
                {selected.data.status}
              </CrmTag>
            </div>
            <p>
              {selected.data.programmeName} · {selected.data.trigger} · Due{" "}
              {formatDubai(selected.data.runAt)} · Published v
              {selected.data.publishedVersion ?? "none"} · Cap{" "}
              {selected.data.maxObservations ?? "unset"}
            </p>
            <p className="text-sm text-[var(--muted)]">
              Dispatch {selected.data.dispatchState} · Attempts{" "}
              {selected.data.attempts} · Outcome{" "}
              {selected.data.outcome ?? "none"} ·{" "}
              {selected.data.n8nClaimed
                ? "n8n claimed"
                : "n8n has not claimed this run"}
            </p>
            {selected.data.lastError ? (
              <p role="status">Last error: {selected.data.lastError}</p>
            ) : null}
            {selected.data.sourceKeys.length ? (
              <p className="text-sm">
                Frozen source keys: {selected.data.sourceKeys.join(", ")}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No frozen collector snapshot yet. Execution is still disabled.
              </p>
            )}
            {canCancel ? (
              <div className="crm-approval-actions">
                <CrmBtn
                  data-testid="discovery-cancel-run"
                  disabled={cancel.isPending}
                  onClick={() =>
                    cancel.mutate({
                      runId: selected.data.runId,
                      expectedStateVersion: selected.data.stateVersion,
                      reason: "Operator cancelled the armed Discovery slot",
                    })
                  }
                >
                  Cancel this run
                </CrmBtn>
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}
