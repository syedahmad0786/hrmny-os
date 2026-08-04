"use client";

import Link from "next/link";
import { useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmTag } from "@/components/crm/ui";

/**
 * W9 deal-detail AI panel. Every action is advisory — "AI proposes; the gate
 * disposes". PRECONDITION_FAILED (kill switch / policy refusal) renders as a
 * friendly "AI disabled" notice instead of a raw error.
 */

type ActionKey = "summary" | "next" | "rescore" | "outreach";

type AgentRunMeta = { model: string; tokens: number; costAed: number };

type ActionResult =
  | { kind: "ok"; text: string; meta: AgentRunMeta; outreachLink?: boolean }
  | { kind: "disabled"; message: string }
  | { kind: "error"; message: string };

/** Agent output is `string | Record<string, unknown>` — pull a readable line. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    for (const key of ["text", "summary", "action", "suggestion", "message"]) {
      if (typeof o[key] === "string") return o[key] as string;
    }
    return JSON.stringify(output, null, 2);
  }
  return String(output ?? "");
}

function toFailure(err: unknown): ActionResult {
  if (
    err instanceof TRPCClientError &&
    err.data?.code === "PRECONDITION_FAILED"
  ) {
    return {
      kind: "disabled",
      message: err.message || "AI runs are currently disabled by policy.",
    };
  }
  return {
    kind: "error",
    message: err instanceof Error ? err.message : "Request failed",
  };
}

const ACTIONS: Array<{
  key: ActionKey;
  label: string;
  hint: string;
  button: string;
}> = [
  {
    key: "summary",
    label: "Summarize deal",
    hint: "Timeline digest from deal, contact, activities and notes.",
    button: "Summarize",
  },
  {
    key: "next",
    label: "Next best action",
    hint: "Suggested next step from stage, BUAF and activity recency.",
    button: "Suggest",
  },
  {
    key: "rescore",
    label: "Re-score BUAF",
    hint: "Re-runs the research agent; writes temperature back, audited.",
    button: "Re-score",
  },
  {
    key: "outreach",
    label: "Draft outreach",
    hint: "Drafts land in the HITL queue — nothing sends without approval.",
    button: "Draft",
  },
];

export function AiDealPanel({ dealId }: { dealId: string }) {
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<ActionKey | null>(null);
  const [results, setResults] = useState<
    Partial<Record<ActionKey, ActionResult>>
  >({});

  async function run(
    key: ActionKey,
    call: () => Promise<{ ok: ActionResult }>,
  ) {
    setPending(key);
    try {
      const { ok } = await call();
      setResults((s) => ({ ...s, [key]: ok }));
    } catch (err) {
      setResults((s) => ({ ...s, [key]: toFailure(err) }));
    } finally {
      setPending(null);
    }
  }

  const handlers: Record<ActionKey, () => void> = {
    summary: () =>
      void run("summary", async () => {
        const r = await utils.client.crmAi.dealSummary.query({ dealId });
        return {
          ok: { kind: "ok", text: outputText(r.output), meta: r.agentRun },
        };
      }),
    next: () =>
      void run("next", async () => {
        const r = await utils.client.crmAi.nextBestAction.query({ dealId });
        return {
          ok: { kind: "ok", text: outputText(r.output), meta: r.agentRun },
        };
      }),
    rescore: () =>
      void run("rescore", async () => {
        const r = await utils.client.crmAi.rescoreBuaf.mutate({ dealId });
        // Refetch the deal so the new BUAF temperature shows immediately.
        void utils.crm.invalidate();
        return {
          ok: {
            kind: "ok",
            text: `BUAF rescored: ${r.output.buafScore} — temperature "${r.output.temperature}". Deal updated.`,
            meta: r.agentRun,
          },
        };
      }),
    outreach: () =>
      void run("outreach", async () => {
        const r = await utils.client.crmAi.draftOutreach.mutate({ dealId });
        const subject = r.output.subject ? ` — "${r.output.subject}"` : "";
        return {
          ok: {
            kind: "ok",
            text: `Draft ${r.output.channel} to ${r.output.recipient}${subject} is waiting in the outreach approval queue.`,
            meta: r.agentRun,
            outreachLink: true,
          },
        };
      }),
  };

  return (
    <div className="crm-panel">
      <div className="crm-panel-head">
        <div>
          <h3>AI assist</h3>
          <p>Drafts only — AI proposes; the gate disposes.</p>
        </div>
        <CrmTag kind="info">Advisory</CrmTag>
      </div>
      <div className="crm-panel-body">
        <div className="crm-checklist">
          {ACTIONS.map((a) => {
            const result = results[a.key];
            const isRunning = pending === a.key;
            return (
              <div key={a.key}>
                <div className="crm-check-row">
                  <span>
                    <strong className="block">{a.label}</strong>
                    <span className="text-[11px] text-[var(--muted)]">
                      {a.hint}
                    </span>
                  </span>
                  <CrmBtn
                    disabled={pending !== null}
                    onClick={handlers[a.key]}
                  >
                    {isRunning ? "Running…" : a.button}
                  </CrmBtn>
                </div>
                {result ? (
                  <div className="mt-2 rounded-xl border border-[var(--line)] bg-white/70 p-3">
                    {result.kind === "disabled" ? (
                      <>
                        <CrmTag kind="warn">AI disabled</CrmTag>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">
                          {result.message} Ask an admin to re-enable AI runs in
                          the AI policy settings.
                        </p>
                      </>
                    ) : result.kind === "error" ? (
                      <>
                        <CrmTag kind="danger">Failed</CrmTag>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">
                          {result.message}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-[12px]">
                          {result.text}
                        </p>
                        {result.outreachLink ? (
                          <Link
                            href="/crm/outreach"
                            className="mt-2 inline-block text-[11px] font-bold text-[var(--ochre-dark)]"
                          >
                            Review in outreach queue →
                          </Link>
                        ) : null}
                        <p className="mt-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                          {result.meta.model} · {result.meta.tokens} tokens ·
                          AED {result.meta.costAed.toFixed(2)} · AI draft —
                          apply human judgment
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
