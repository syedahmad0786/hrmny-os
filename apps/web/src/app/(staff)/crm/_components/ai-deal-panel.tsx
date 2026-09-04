"use client";

import Link from "next/link";
import { useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmTag } from "@/components/crm/ui";
import { formatRelative } from "@/components/crm/format";

/**
 * W9 deal-detail AI panel. Every action is advisory — "AI proposes; the gate
 * disposes". PRECONDITION_FAILED (kill switch / policy refusal) renders as a
 * friendly "AI disabled" notice instead of a raw error.
 */

type ActionKey = "research" | "summary" | "next" | "rescore" | "outreach";

type AgentRunMeta = { model: string; tokens: number; costAed: number };

type ActionResult =
  | { kind: "ok"; text: string; meta: AgentRunMeta; outreachId?: string }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

type KnowledgeBrief = {
  crmNoteId: string;
  body: string;
  createdAt: string;
};

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
      kind: "blocked",
      message: err.message || "AI runs are currently disabled by policy.",
    };
  }
  if (err instanceof TRPCClientError && err.data?.code === "FORBIDDEN") {
    return {
      kind: "blocked",
      message: "Your account does not have Sales operator access.",
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
    key: "research",
    label: "Build knowledge brief",
    hint: "Live company research, pain points, hrmny service angle and cited sources. Saved to Notes.",
    button: "Research",
  },
  {
    key: "outreach",
    label: "Create email draft",
    hint: "Uses the saved brief. Review and approve it before Gmail can send.",
    button: "Create draft",
  },
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
];

function briefBody(body: string) {
  const lines = body.split("\n");
  if (lines[0]?.startsWith("SALES KNOWLEDGE BRIEF —")) lines.shift();
  if (lines[0]?.startsWith("Research request:")) lines.shift();
  return lines.join("\n").trim();
}

export function AiDealPanel({
  dealId,
  emailReady,
  knowledgeBrief,
}: {
  dealId: string;
  emailReady: boolean;
  knowledgeBrief: KnowledgeBrief | null;
}) {
  const utils = trpc.useUtils();
  const [pending, setPending] = useState<ActionKey | null>(null);
  const [reviewApolloUnlock, setReviewApolloUnlock] = useState(false);
  const [unlockResult, setUnlockResult] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [results, setResults] = useState<
    Partial<Record<ActionKey, ActionResult>>
  >({});
  const apolloCandidate = trpc.salesOs.apollo.candidateForDeal.useQuery(
    { dealId },
    { enabled: !emailReady, retry: false },
  );
  const apolloConnection = trpc.salesOs.apollo.connection.useQuery(undefined, {
    enabled: !emailReady,
    retry: false,
  });
  const enrichExact = trpc.salesOs.apollo.enrichOne.useMutation({
    onSuccess: (payload) => {
      setReviewApolloUnlock(false);
      const email = payload.crm?.email;
      const verified = payload.crm?.emailVerified === true;
      setUnlockResult({
        kind: verified ? "success" : "error",
        message: verified
          ? `${email} was unlocked and verified. You can create the email draft now.`
          : `${payload.reason ?? "Apollo did not return a verified work email."} ${payload.creditsRecorded} credit was recorded.`,
      });
      void utils.crm.invalidate();
      void utils.salesOs.apollo.candidateForDeal.invalidate({ dealId });
    },
    onError: (error) => {
      setReviewApolloUnlock(false);
      setUnlockResult({ kind: "error", message: error.message });
    },
  });
  const approveExact = trpc.salesOs.apollo.approveExact.useMutation({
    onSuccess: (approval, variables) =>
      enrichExact.mutate({
        candidate: variables.candidate,
        confirmCreditUse: true,
        approvalReceiptId: approval.approvalReceiptId,
      }),
    onError: (error) => {
      setReviewApolloUnlock(false);
      setUnlockResult({ kind: "error", message: error.message });
    },
  });

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
    research: () => {
      const confirmed = window.confirm(
        "Run live OpenRouter web research? The company and public professional context will be sent to OpenRouter. Search is capped at 2 provider queries (up to about US$0.01 at current pricing). Nothing will be emailed or posted.",
      );
      if (!confirmed) return;
      void run("research", async () => {
        const r = await utils.client.crmAi.companyKnowledgeBrief.mutate({
          dealId,
          requestId: crypto.randomUUID(),
          confirmWebResearch: true,
        });
        void utils.crm.notes.invalidate();
        return {
          ok: {
            kind: "ok",
            text: `Knowledge brief saved below with ${r.sources.length} verified source${r.sources.length === 1 ? "" : "s"}.`,
            meta: r.agentRun,
          },
        };
      });
    },
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
    outreach: () => {
      if (!knowledgeBrief) {
        setResults((state) => ({
          ...state,
          outreach: {
            kind: "blocked",
            message:
              "Build the knowledge brief first. Research is saved here before AI can draft outreach.",
          },
        }));
        return;
      }
      if (!emailReady) {
        if (apolloCandidate.data) {
          setReviewApolloUnlock(true);
          setUnlockResult(null);
        } else {
          setResults((state) => ({
            ...state,
            outreach: {
              kind: "blocked",
              message:
                "This lead has no reusable Apollo person receipt. Find the person in Apollo, then return here to draft the email.",
            },
          }));
        }
        return;
      }
      void run("outreach", async () => {
        const r = await utils.client.crmAi.draftOutreach.mutate({ dealId });
        const subject = r.output.subject ? ` — "${r.output.subject}"` : "";
        return {
          ok: {
            kind: "ok",
            text: `Draft ${r.output.channel} to ${r.output.recipient}${subject} is waiting in the outreach approval queue.`,
            meta: r.agentRun,
            outreachId: r.output.id,
          },
        };
      });
    },
  };

  return (
    <div id="ai-assist" className="crm-panel">
      <div className="crm-panel-head">
        <div>
          <h3>AI assist</h3>
          <p>Drafts only — AI proposes; the gate disposes.</p>
        </div>
        <CrmTag kind="info">Advisory</CrmTag>
      </div>
      <div className="crm-panel-body">
        <div className="crm-note mb-3" data-testid="deal-sales-path">
          <strong>Sales path:</strong> 1. Research company → 2. Create email
          draft → 3. Review and approve → 4. Send via Gmail → 5. Monitor reply
          in the pipeline.
        </div>
        {knowledgeBrief ? (
          <article
            className="mb-3 rounded-xl border border-[var(--line)] bg-white/70 p-4"
            data-testid="deal-knowledge-brief"
          >
            <div className="flex items-center justify-between gap-3">
              <span>
                <strong className="block">Saved knowledge brief</strong>
                <small className="text-[var(--muted)]">
                  Saved {formatRelative(knowledgeBrief.createdAt)}
                </small>
              </span>
              <CrmTag kind="success">Ready</CrmTag>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-[12px]">
              {briefBody(knowledgeBrief.body)}
            </p>
          </article>
        ) : (
          <div className="crm-note mb-3">
            No knowledge brief yet. Select Research to build and save one for
            this lead.
          </div>
        )}
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
                  <CrmBtn disabled={pending !== null} onClick={handlers[a.key]}>
                    {isRunning
                      ? "Running…"
                      : a.key === "research" && knowledgeBrief
                        ? "Refresh research"
                        : a.key === "outreach" && !knowledgeBrief
                          ? "Research first"
                          : a.key === "outreach" && !emailReady
                            ? apolloCandidate.isLoading
                              ? "Checking Apollo…"
                              : apolloCandidate.data
                                ? "Unlock with Apollo"
                                : "Find email"
                            : a.button}
                  </CrmBtn>
                </div>
                {a.key === "outreach" && reviewApolloUnlock ? (
                  <div className="crm-note mt-2" role="status">
                    {apolloCandidate.data ? (
                      <>
                        <CrmTag kind="warn">Apollo credit check</CrmTag>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">
                          Unlock{" "}
                          {apolloCandidate.data.fullName ?? "this person"}
                          {apolloCandidate.data.title
                            ? `, ${apolloCandidate.data.title}`
                            : ""}{" "}
                          at{" "}
                          {apolloCandidate.data.companyName ?? "this company"}.
                          Apollo may use up to 1 work-email credit. Phone,
                          personal email, and waterfall lookups stay off.
                        </p>
                        {!apolloConnection.data?.configured ? (
                          <p className="mt-2 text-[11px] text-[var(--danger)]">
                            Apollo is not connected for your account.{" "}
                            <Link
                              href="/settings/connections#conn-apollo"
                              className="underline"
                            >
                              Connect Apollo
                            </Link>
                          </p>
                        ) : null}
                        <div className="crm-approval-actions mt-2">
                          <CrmBtn
                            variant="primary"
                            data-testid="deal-apollo-unlock-confirm"
                            disabled={
                              !apolloConnection.data?.configured ||
                              approveExact.isPending ||
                              enrichExact.isPending
                            }
                            onClick={() =>
                              approveExact.mutate({
                                candidate: apolloCandidate.data!,
                                confirmCreditUse: true,
                              })
                            }
                          >
                            {approveExact.isPending || enrichExact.isPending
                              ? "Unlocking…"
                              : "Confirm unlock · up to 1 credit"}
                          </CrmBtn>
                          <CrmBtn
                            disabled={
                              approveExact.isPending || enrichExact.isPending
                            }
                            onClick={() => setReviewApolloUnlock(false)}
                          >
                            Cancel
                          </CrmBtn>
                        </div>
                      </>
                    ) : (
                      <p className="text-[11px] text-[var(--muted)]">
                        The original Apollo person is unavailable.{" "}
                        <Link
                          href="/crm/hunt#apollo-people-search"
                          className="font-bold underline"
                        >
                          Find the work email in Apollo →
                        </Link>
                      </p>
                    )}
                  </div>
                ) : null}
                {a.key === "outreach" && unlockResult ? (
                  <div className="crm-note mt-2" role="status">
                    <CrmTag
                      kind={
                        unlockResult.kind === "success" ? "success" : "danger"
                      }
                    >
                      {unlockResult.kind === "success"
                        ? "Email ready"
                        : "Unlock failed"}
                    </CrmTag>{" "}
                    {unlockResult.message}
                  </div>
                ) : null}
                {result ? (
                  <div className="mt-2 rounded-xl border border-[var(--line)] bg-white/70 p-3">
                    {result.kind === "blocked" ? (
                      <>
                        <CrmTag kind="warn">Action blocked</CrmTag>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">
                          {result.message}
                        </p>
                        {a.key === "outreach" && !emailReady ? (
                          <Link
                            href="/crm/hunt#apollo-people-search"
                            className="mt-2 inline-block text-[11px] font-bold text-[var(--ochre-dark)] underline"
                          >
                            Find the work email in Apollo →
                          </Link>
                        ) : null}
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
                        {result.outreachId ? (
                          <Link
                            href={`/crm/outreach?id=${result.outreachId}`}
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
