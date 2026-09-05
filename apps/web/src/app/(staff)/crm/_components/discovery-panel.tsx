"use client";

import Link from "next/link";
import type {
  DiscoveryCandidate,
  DiscoveryResult,
} from "@/server/sales-os/discovery";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn } from "@/components/crm/ui";

export function DiscoveryPanel() {
  const utils = trpc.useUtils();
  const access = trpc.salesOs.access.useQuery();
  const [focus, setFocus] = useState("");
  const [mode, setMode] = useState<"signals" | "tenders">("signals");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [note, setNote] = useState("");
  const history = trpc.salesOs.research.history.useQuery(undefined, {
    enabled: access.data?.canOperate === true,
    refetchInterval: 15000,
  });
  const options = {
    onSuccess: (result: { proposed: number; rejected: number }) => {
      setNote(
        `${result.proposed} companies ready for review · ${result.rejected} excluded. Open each source before approving.`,
      );
      setRequestId(crypto.randomUUID());
      void utils.salesOs.research.invalidate();
    },
    onError: (error: { message: string }) => {
      setNote(error.message);
      void utils.salesOs.research.history.invalidate();
    },
  };
  const discover = trpc.salesOs.research.discover.useMutation(options);
  const sourceImport = trpc.salesOs.research.importSources.useMutation(options);
  const busy = discover.isPending || sourceImport.isPending;
  return (
    <section className="crm-panel mb-5" aria-label="Find opportunities">
      <div className="crm-panel-head">
        <div>
          <h2>Find the next opportunity</h2>
          <p>
            Recent hiring, launches, leadership changes and open tenders, with
            sources to review.
          </p>
        </div>
        <Link className="crm-btn" href="/crm/intelligence">
          Prepare for a meeting
        </Link>
      </div>
      <form
        className="crm-panel-body space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setNote(
            "Researching dated sources. You can return here to check the result.",
          );
          discover.mutate({ requestId, focus, mode });
        }}
      >
        <div className="crm-form-grid">
          <label className="crm-field">
            Focus
            <input
              className="crm-input"
              value={focus}
              maxLength={300}
              onChange={(event) => {
                setFocus(event.target.value);
                setRequestId(crypto.randomUUID());
              }}
              placeholder="Use today's sector rotation, or enter a sector and market"
            />
          </label>
          <label className="crm-field">
            Opportunity type
            <select
              className="crm-select"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as typeof mode);
                setRequestId(crypto.randomUUID());
              }}
            >
              <option value="signals">Hiring, launches & leadership</option>
              <option value="tenders">Open tenders & RFPs</option>
            </select>
          </label>
        </div>
        <p className="text-sm text-[var(--muted)]">
          One bounded web research run; provider charges and your AI limits
          apply. Results are proposals. Budget, access and buying intent still
          need confirmation.
        </p>
        <CrmBtn
          type="submit"
          variant="primary"
          disabled={busy || !access.data?.canOperate}
        >
          {busy ? "Researching…" : "Find opportunities"}
        </CrmBtn>
        {discover.isError ? (
          <CrmBtn
            type="button"
            onClick={() => {
              setRequestId(crypto.randomUUID());
              setNote(
                "New run prepared. Check history before starting another charged search.",
              );
            }}
          >
            Prepare a new run
          </CrmBtn>
        ) : null}
        {note ? (
          <p className="crm-note" role="status">
            {note}
          </p>
        ) : null}
        <details>
          <summary className="cursor-pointer">
            Import a permitted source feed
          </summary>
          <p className="my-2 text-sm">
            Upload a JSON array from your reviewed Apify dataset, licensed
            intent export or tender source. Each row needs name, website,
            sector, kind (news/hiring/leadership/tender/intent), publishedOn,
            evidence URL, excerpt, whyNow and service. Tenders also need
            deadline. Dates use YYYY-MM-DD. The same freshness, duplicate and
            review checks apply.
          </p>
          <label className="crm-field">
            Source JSON
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy || !access.data?.canOperate}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 500000)
                    throw new Error("Keep the feed below 500 KB and 100 rows");
                  const candidates: unknown = JSON.parse(await file.text());
                  if (!Array.isArray(candidates))
                    throw new Error("Upload a JSON array");
                  sourceImport.mutate({
                    requestId: crypto.randomUUID(),
                    focus,
                    mode,
                    candidates: candidates as DiscoveryCandidate[],
                  });
                } catch (error) {
                  setNote(
                    error instanceof Error
                      ? error.message
                      : "Source import failed",
                  );
                }
                event.target.value = "";
              }}
            />
          </label>
        </details>
        <details>
          <summary className="cursor-pointer">Your research history</summary>
          {history.error ? (
            <p role="alert">History could not load: {history.error.message}</p>
          ) : null}
          {history.data?.length === 0 ? (
            <p className="mt-2 text-sm">No research runs yet.</p>
          ) : null}
          {history.data?.map((row) => (
            <div
              key={row.id}
              className="my-3 border-t border-[var(--line)] pt-3"
            >
              <strong>{row.status}</strong>
              <span className="ml-2 text-sm">
                {String(row.result?.sector ?? "Research run")}
              </span>
              {row.error ? <p role="alert">{row.error}</p> : null}
              {row.result ? (
                <div className="mt-2 text-sm">
                  <p>
                    {String(row.result.proposed ?? 0)} proposed ·{" "}
                    {String(row.result.rejected ?? 0)} excluded ·{" "}
                    {String(row.result.completedAt ?? "")}
                  </p>
                  {(
                    (row.result as unknown as DiscoveryResult).proposals ?? []
                  ).map((proposal) => (
                    <p key={proposal.id}>{proposal.name}</p>
                  ))}
                  {(
                    (row.result as unknown as DiscoveryResult).exclusions ?? []
                  ).map((excluded, index) => (
                    <p key={index} className="text-[var(--muted)]">
                      {excluded.name}: {excluded.reason}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm">
                  The run has no completed result. A refresh does not start
                  another search.
                </p>
              )}
            </div>
          ))}
        </details>
      </form>
    </section>
  );
}
