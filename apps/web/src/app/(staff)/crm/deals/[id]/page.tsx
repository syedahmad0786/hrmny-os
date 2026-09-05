"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn, CrmEmpty, CrmPageHeader, CrmTag } from "@/components/crm/ui";
import {
  buafScore,
  formatContactName,
  formatAed,
  formatLane,
  formatRelative,
  workEmailState,
} from "@/components/crm/format";
import { AiDealPanel } from "../../_components/ai-deal-panel";

const NEXT: Record<string, string> = {
  discover: "qualify",
  qualify: "engage",
  engage: "scope",
  scope: "propose",
  propose: "price_cost",
  price_cost: "close",
  close: "handover_pack",
};

const NEXT_GATE: Record<string, string> = {
  discover: "Review the lead and decide whether it is worth pursuing.",
  qualify: "Confirm Fit and at least three of the four BUAF checks.",
  engage:
    "Verify the work email and approve the first outreach before defining needs.",
  scope: "Capture what the client needs before preparing a proposal.",
  propose: "Build the scope and client pricing before agreeing commercials.",
  price_cost:
    "Meet the 25% margin floor and get any required discount approval.",
  close: "Record the outcome. Won deals can then move to client onboarding.",
  handover_pack: "Open the client record and continue onboarding in Delivery.",
};

function humanizeCrmBody(body: string): string {
  return body.startsWith("Apollo person reconciled. {")
    ? "Apollo contact added to this deal. No phone, personal email, or waterfall lookup was used."
    : body;
}

export default function CrmDealDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const utils = trpc.useUtils();
  const deal = trpc.crm.deals.get.useQuery({ id });
  const stages = trpc.crm.stages.useQuery();
  const primaryContact = trpc.crm.contacts.get.useQuery(
    { id: deal.data?.primaryContactId ?? "" },
    { enabled: Boolean(deal.data?.primaryContactId) },
  );
  const session = trpc.auth.session.useQuery();
  const employees = trpc.work.members.listEmployees.useQuery();
  const activities = trpc.crm.activities.list.useQuery({
    dealId: id,
    limit: 50,
  });
  const notes = trpc.crm.notes.list.useQuery({ dealId: id });
  const tasks = trpc.crm.tasks.list.useQuery({ dealId: id });

  const update = trpc.crm.deals.update.useMutation({
    onSuccess: () => void utils.crm.invalidate(),
  });
  const move = trpc.crm.deals.moveStage.useMutation({
    onSuccess: () => void utils.crm.invalidate(),
  });
  const closeDeal = trpc.crm.deals.close.useMutation({
    onSuccess: () => void utils.crm.invalidate(),
  });
  const handover = trpc.crm.deals.handoverPack.useMutation({
    onSuccess: () => {
      void utils.crm.invalidate();
      void utils.clients.invalidate();
      void utils.tasks.invalidate();
    },
  });
  const logActivity = trpc.crm.activities.create.useMutation({
    onSuccess: () => void utils.crm.activities.invalidate(),
  });
  const addNote = trpc.crm.notes.create.useMutation({
    onSuccess: () => void utils.crm.notes.invalidate(),
  });
  const createTask = trpc.crm.tasks.create.useMutation({
    onSuccess: () => void utils.crm.tasks.invalidate(),
  });
  const updateTask = trpc.crm.tasks.update.useMutation({
    onSuccess: () => void utils.crm.tasks.invalidate(),
  });

  const d = deal.data;
  const [budget, setBudget] = useState(false);
  const [urgency, setUrgency] = useState(false);
  const [access, setAccess] = useState(false);
  const [fit, setFit] = useState(false);
  const [temp, setTemp] = useState<"hot" | "warm" | "cool" | "cold" | "">("");
  const [note, setNote] = useState("");
  const [nextActionTitle, setNextActionTitle] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [nextActionOwner, setNextActionOwner] = useState("");
  const [needObjective, setNeedObjective] = useState("");
  const [needDeliverables, setNeedDeliverables] = useState("");
  const [needTiming, setNeedTiming] = useState("");
  const [needDecisionMaker, setNeedDecisionMaker] = useState("");
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [opportunityName, setOpportunityName] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");

  useEffect(() => {
    if (!d) return;
    setBudget(Boolean(d.buafBudget));
    setUrgency(Boolean(d.buafUrgency));
    setAccess(Boolean(d.buafAccess));
    setFit(Boolean(d.buafFit));
    setTemp(d.buafTemperature ?? "");
    setOpportunityName(d.opportunityName ?? "");
    setExpectedCloseDate(d.expectedCloseDate ?? "");
  }, [d]);

  const score = useMemo(() => (d ? buafScore(d) : null), [d]);
  const nextTask = useMemo(
    () =>
      [...(tasks.data ?? [])]
        .filter((task) => task.status !== "done" && task.status !== "cancelled")
        .sort((a, b) => {
          if (a.dueDate !== b.dueDate) {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate);
          }
          return a.createdAt.localeCompare(b.createdAt);
        })[0],
    [tasks.data],
  );
  const nextStage = d?.stage ? NEXT[String(d.stage)] : undefined;
  const stageLabel =
    stages.data?.find((stage) => stage.key === d?.stage)?.label ??
    String(d?.stage ?? "").replace(/_/g, " ");
  const nextStageLabel =
    stages.data?.find((stage) => stage.key === nextStage)?.label ??
    nextStage?.replace(/_/g, " ");
  const contactName = formatContactName(primaryContact.data);
  const email = workEmailState(primaryContact.data, d?.emailVerified);
  const knowledgeBrief = (notes.data ?? []).find((item) =>
    item.body.startsWith("SALES KNOWLEDGE BRIEF —"),
  );
  const needsNote = [...(notes.data ?? [])]
    .filter((item) => item.body.startsWith("SALES NEEDS —"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const savedNeeds = useMemo(() => {
    if (!needsNote) return null;
    try {
      const value = JSON.parse(
        needsNote.body.slice("SALES NEEDS —".length).trim(),
      ) as Record<string, unknown>;
      return {
        objective: typeof value.objective === "string" ? value.objective : "",
        deliverables:
          typeof value.deliverables === "string" ? value.deliverables : "",
        timing: typeof value.timing === "string" ? value.timing : "",
        decisionMaker:
          typeof value.decisionMaker === "string" ? value.decisionMaker : "",
      };
    } catch {
      return null;
    }
  }, [needsNote]);
  const regularNotes = (notes.data ?? []).filter(
    (item) =>
      !item.body.startsWith("SALES KNOWLEDGE BRIEF —") &&
      !item.body.startsWith("SALES NEEDS —"),
  );
  const needsComplete = Boolean(
    savedNeeds && Object.values(savedNeeds).every((value) => value.trim()),
  );
  const canConfirmWon = Boolean(
    session.data?.roles.some((role) => ["partner", "director"].includes(role)),
  );

  useEffect(() => {
    if (tasks.isLoading) return;
    setNextActionTitle(nextTask?.title ?? "");
    setNextActionDate(nextTask?.dueDate?.slice(0, 10) ?? "");
    setNextActionOwner(
      nextTask?.ownerEmployeeId ??
        d?.ownerEmployeeId ??
        session.data?.employeeId ??
        "",
    );
  }, [
    nextTask?.crmTaskId,
    nextTask?.title,
    nextTask?.dueDate,
    nextTask?.ownerEmployeeId,
    d?.ownerEmployeeId,
    session.data?.employeeId,
    tasks.isLoading,
  ]);

  useEffect(() => {
    if (notes.isLoading) return;
    setNeedObjective(savedNeeds?.objective ?? "");
    setNeedDeliverables(savedNeeds?.deliverables ?? "");
    setNeedTiming(savedNeeds?.timing ?? "");
    setNeedDecisionMaker(savedNeeds?.decisionMaker ?? "");
  }, [notes.isLoading, savedNeeds]);

  if (deal.isLoading) {
    return <CrmEmpty title="Loading deal…" />;
  }

  if (!d) {
    return (
      <main>
        <CrmEmpty
          title="Deal not found"
          hint="It may have been removed or the id is invalid."
        />
        <Link
          href="/crm"
          className="mt-4 inline-block text-[var(--ochre-dark)]"
        >
          ← Back to pipeline
        </Link>
      </main>
    );
  }

  return (
    <main>
      <CrmPageHeader
        kicker="CRM · Deal detail"
        title={d.opportunityName ?? d.companyName}
        description={`${contactName ? `${d.companyName} · ` : ""}${primaryContact.data?.title ? `${primaryContact.data.title} · ` : ""}${stageLabel} · ${formatLane(d.leadSourceLane)} · ${formatAed(d.quoteValue)}`}
        actions={
          <>
            <Link href="/crm">
              <CrmBtn>← Pipeline</CrmBtn>
            </Link>
            {nextStage && nextStage !== "handover_pack" ? (
              <CrmBtn
                variant="primary"
                data-testid="deal-advance"
                disabled={move.isPending}
                onClick={async () => {
                  const r = await move.mutateAsync({ id, to: nextStage });
                  setActionStatus(
                    r.ok
                      ? `Moved to ${nextStageLabel}.`
                      : `Could not advance: ${r.reason ?? "stage requirements are incomplete"}`,
                  );
                }}
              >
                Next: {nextStageLabel} →
              </CrmBtn>
            ) : null}
            {canConfirmWon &&
            d.stage === "close" &&
            d.closeOutcome !== "won" ? (
              <CrmBtn
                variant="primary"
                data-testid="deal-mark-won"
                disabled={closeDeal.isPending}
                onClick={async () => {
                  const r = await closeDeal.mutateAsync({
                    id,
                    outcome: "won",
                  });
                  setActionStatus(
                    r.ok ? "Deal marked won." : `Could not close: ${r.reason}`,
                  );
                }}
              >
                Mark won
              </CrmBtn>
            ) : null}
            {canConfirmWon &&
            d.closeOutcome === "won" &&
            (d.stage === "close" || d.stage === "handover_pack") ? (
              <CrmBtn
                variant="primary"
                id="handover"
                data-testid="deal-handover"
                disabled={handover.isPending}
                onClick={async () => {
                  const r = await handover.mutateAsync({ id });
                  setActionStatus(
                    r.ok
                      ? "Client handover is ready."
                      : `Could not create handover: ${r.reason}`,
                  );
                }}
              >
                {d.stage === "handover_pack"
                  ? "Review handover →"
                  : "Handover pack → client"}
              </CrmBtn>
            ) : null}
            {d.stage === "handover_pack" ? (
              <Link href="/clients">
                <CrmBtn variant="primary">Open clients →</CrmBtn>
              </Link>
            ) : null}
            {handover.data &&
            "ok" in handover.data &&
            handover.data.ok &&
            "client" in handover.data ? (
              <div
                className="flex flex-wrap gap-2"
                data-testid="deal-handover-next"
              >
                <Link
                  href={`/clients/${handover.data.client.clientId}`}
                  data-testid="deal-handover-client"
                >
                  <CrmBtn variant="primary">Open client onboarding →</CrmBtn>
                </Link>
                {"next" in handover.data && handover.data.next ? (
                  <>
                    <Link href={handover.data.next.account}>
                      <CrmBtn>Account calendar →</CrmBtn>
                    </Link>
                    <Link
                      href={handover.data.next.creative}
                      data-testid="deal-handover-creative"
                    >
                      <CrmBtn>Creative →</CrmBtn>
                    </Link>
                    <Link href={handover.data.next.approvals}>
                      <CrmBtn>Approvals →</CrmBtn>
                    </Link>
                    {"outreach" in handover.data.next &&
                    handover.data.next.outreach ? (
                      <Link href={handover.data.next.outreach}>
                        <CrmBtn>Outreach draft →</CrmBtn>
                      </Link>
                    ) : null}
                    {"finance" in handover.data.next &&
                    handover.data.next.finance ? (
                      <Link
                        href={handover.data.next.finance}
                        data-testid="deal-handover-finance"
                      >
                        <CrmBtn>First invoice →</CrmBtn>
                      </Link>
                    ) : null}
                    {handover.data.portalInvite?.portalPath ? (
                      <Link
                        href={handover.data.portalInvite.portalPath}
                        data-testid="deal-handover-portal"
                      >
                        <CrmBtn>
                          Portal approvals (
                          {handover.data.portalInvite.delivery?.mode ?? "mock"})
                          →
                        </CrmBtn>
                      </Link>
                    ) : null}
                    {handover.data.portalInvite?.onboardingPath ? (
                      <Link
                        href={handover.data.portalInvite.onboardingPath}
                        data-testid="deal-handover-onboarding-invite"
                      >
                        <CrmBtn>Onboarding invite →</CrmBtn>
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        }
      />

      <div
        className="crm-panel mb-4"
        id="next-action"
        data-testid="deal-next-action"
      >
        <div className="crm-panel-head">
          <div>
            <h3>Next action</h3>
            <p>
              {nextTask
                ? "The earliest open sales task for this deal."
                : "Set one clear action so this deal does not stall."}
            </p>
          </div>
          <CrmTag kind={nextTask ? "info" : "warn"}>
            {nextTask ? nextTask.status.replace(/_/g, " ") : "Not set"}
          </CrmTag>
        </div>
        <div className="crm-panel-body">
          <div className="crm-form-grid">
            <div className="crm-field wide">
              <label htmlFor="deal-next-action-title">Action</label>
              <input
                id="deal-next-action-title"
                data-testid="deal-next-action-title"
                value={nextActionTitle}
                placeholder="Example: Follow up with the decision maker"
                onChange={(event) => setNextActionTitle(event.target.value)}
              />
            </div>
            <div className="crm-field">
              <label htmlFor="deal-next-action-date">Due date</label>
              <input
                id="deal-next-action-date"
                data-testid="deal-next-action-date"
                type="date"
                value={nextActionDate}
                onChange={(event) => setNextActionDate(event.target.value)}
              />
            </div>
            <div className="crm-field">
              <label htmlFor="deal-next-action-owner">Owner</label>
              <select
                id="deal-next-action-owner"
                value={nextActionOwner}
                onChange={(event) => setNextActionOwner(event.target.value)}
              >
                <option value="">Choose a teammate</option>
                {(employees.data ?? []).map((person) => (
                  <option key={person.employeeId} value={person.employeeId}>
                    {person.displayLabel}
                  </option>
                ))}
                {nextActionOwner &&
                !employees.data?.some(
                  (person) => person.employeeId === nextActionOwner,
                ) ? (
                  <option value={nextActionOwner}>
                    {nextActionOwner === session.data?.employeeId
                      ? "You"
                      : "Current owner"}
                  </option>
                ) : null}
              </select>
            </div>
          </div>
          {createTask.error || updateTask.error ? (
            <p role="alert">
              {createTask.error?.message ?? updateTask.error?.message}
            </p>
          ) : null}
          <div className="crm-approval-actions">
            <CrmBtn
              variant="primary"
              data-testid="deal-next-action-save"
              disabled={
                !nextActionTitle.trim() ||
                !nextActionDate ||
                !nextActionOwner ||
                !session.data?.employeeId ||
                createTask.isPending ||
                updateTask.isPending
              }
              onClick={async () => {
                if (!session.data?.employeeId) return;
                const taskInput = {
                  title: nextActionTitle.trim(),
                  dueDate: nextActionDate || null,
                  ownerEmployeeId: nextActionOwner,
                };
                if (nextTask) {
                  await updateTask.mutateAsync({
                    id: nextTask.crmTaskId,
                    ...taskInput,
                  });
                } else {
                  await createTask.mutateAsync({
                    ...taskInput,
                    dealId: id,
                    companyId: d.companyId,
                    contactId: d.primaryContactId,
                  });
                }
                if (!d.ownerEmployeeId)
                  await update.mutateAsync({
                    id,
                    ownerEmployeeId: nextActionOwner,
                  });
                await utils.salesOs.digest.invalidate();
                setActionStatus(
                  nextTask ? "Next action updated." : "Next action created.",
                );
              }}
            >
              {nextTask ? "Save next action" : "Create next action"}
            </CrmBtn>
            {nextTask ? (
              <CrmBtn
                disabled={updateTask.isPending}
                onClick={async () => {
                  try {
                    await updateTask.mutateAsync({
                      id: nextTask.crmTaskId,
                      status: "done",
                    });
                    await utils.salesOs.digest.invalidate();
                    setActionStatus(
                      "Action completed. Schedule the next commitment when you are ready.",
                    );
                  } catch (error) {
                    setActionStatus(
                      error instanceof Error
                        ? error.message
                        : "Could not complete. Try again.",
                    );
                  }
                }}
              >
                Mark complete
              </CrmBtn>
            ) : null}
            {!nextActionDate ? (
              <p className="crm-note">
                Choose a due date so this appears in your daily work.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <section className="crm-panel mb-4">
        <div className="crm-panel-head">
          <h2>Relationship and opportunity</h2>
        </div>
        <div className="crm-panel-body">
          <div className="crm-form-grid">
            <div className="crm-field">
              <label htmlFor="opportunity-name">Opportunity name</label>
              <input
                id="opportunity-name"
                value={opportunityName}
                maxLength={200}
                placeholder="For example, autumn brand campaign"
                onChange={(event) => setOpportunityName(event.target.value)}
              />
            </div>
            <div className="crm-field">
              <label htmlFor="expected-close-date">
                Expected decision date
              </label>
              <input
                id="expected-close-date"
                type="date"
                value={expectedCloseDate}
                onChange={(event) => setExpectedCloseDate(event.target.value)}
              />
            </div>
          </div>
          <div className="crm-approval-actions">
            <CrmBtn
              disabled={update.isPending}
              onClick={async () => {
                try {
                  await update.mutateAsync({
                    id,
                    opportunityName: opportunityName.trim() || null,
                    expectedCloseDate: expectedCloseDate || null,
                  });
                  setActionStatus("Opportunity details saved.");
                } catch (error) {
                  setActionStatus(
                    error instanceof Error
                      ? error.message
                      : "Could not save. Try again.",
                  );
                }
              }}
            >
              Save details
            </CrmBtn>
            {!d.ownerEmployeeId ? (
              <CrmBtn
                disabled={update.isPending || !session.data?.employeeId}
                onClick={async () => {
                  try {
                    await update.mutateAsync({
                      id,
                      ownerEmployeeId: session.data!.employeeId,
                    });
                    setActionStatus(
                      "You now own this relationship. Schedule the next action below.",
                    );
                  } catch (error) {
                    setActionStatus(
                      error instanceof Error
                        ? error.message
                        : "Could not assign. Try again.",
                    );
                  }
                }}
              >
                Assign relationship to me
              </CrmBtn>
            ) : (
              <span>
                {d.ownerEmployeeId === session.data?.employeeId
                  ? "Relationship owner: you"
                  : "Relationship has an owner"}
              </span>
            )}
          </div>
          {update.error ? <p role="alert">{update.error.message}</p> : null}
        </div>
      </section>

      <section className="crm-panel mb-4" data-testid="deal-stage-strip">
        <div className="crm-panel-head">
          <div>
            <h3>Deal progress</h3>
            <p>One path from new lead to client onboarding.</p>
          </div>
          <CrmTag kind="ochre">Current: {stageLabel}</CrmTag>
        </div>
        <div className="crm-panel-body">
          <ol className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {(stages.data ?? []).map((stage, index) => {
              const current = stage.key === d.stage;
              const currentIndex = (stages.data ?? []).findIndex(
                (item) => item.key === d.stage,
              );
              const complete = currentIndex >= 0 && index < currentIndex;
              return (
                <li
                  key={stage.key}
                  data-testid="deal-stage"
                  data-stage={stage.key}
                  data-current={current ? "true" : "false"}
                  aria-current={current ? "step" : undefined}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                    current
                      ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                      : complete
                        ? "border-[var(--ochre)] bg-[var(--paper)] text-[var(--ochre-dark)]"
                        : "border-[var(--line)] bg-white text-[var(--muted)]"
                  }`}
                >
                  <span className="mb-1 block text-xs opacity-70">
                    {complete ? "✓" : String(index + 1).padStart(2, "0")}
                  </span>
                  {stage.label}
                </li>
              );
            })}
          </ol>
          <div
            className="crm-note mt-3 flex flex-wrap items-center justify-between gap-3"
            data-testid="deal-next-gate"
          >
            <span>
              <strong>
                {nextStageLabel
                  ? `To move to ${nextStageLabel}: `
                  : "What happens next: "}
              </strong>
              {NEXT_GATE[String(d.stage)] ??
                "Review this deal and choose the next action."}
            </span>
          </div>
        </div>
      </section>

      {actionStatus ? (
        <div className="crm-note mb-4" role="status" aria-live="polite">
          {actionStatus}
        </div>
      ) : null}

      <section className="crm-split">
        <div className="space-y-4">
          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Lead qualification</h3>
                <p>
                  Tick only confirmed facts: budget, urgency, decision access,
                  and service fit.
                </p>
              </div>
              <CrmTag kind={score && score.done === 4 ? "success" : "warn"}>
                {score?.label ?? "—"}
              </CrmTag>
            </div>
            <div className="crm-panel-body">
              <div className="crm-checklist">
                {(
                  [
                    ["Budget", budget, setBudget],
                    ["Urgency", urgency, setUrgency],
                    ["Access / Authority", access, setAccess],
                    ["Fit", fit, setFit],
                  ] as const
                ).map(([label, val, set]) => (
                  <label key={label} className="crm-check-row">
                    <input
                      type="checkbox"
                      data-testid={`deal-buaf-${(label.split(" ")[0] ?? "flag").toLowerCase()}`}
                      checked={val}
                      onChange={(e) => set(e.target.checked)}
                    />
                    {label}
                    <span>{val ? "Confirmed" : "Missing"}</span>
                  </label>
                ))}
              </div>
              <div className="crm-form-grid mt-4">
                <div className="crm-field">
                  <label>Temperature</label>
                  <select
                    className="crm-select"
                    data-testid="deal-buaf-temperature"
                    value={temp}
                    onChange={(e) => setTemp(e.target.value as typeof temp)}
                  >
                    <option value="">Unset</option>
                    <option value="hot">Hot</option>
                    <option value="warm">Warm</option>
                    <option value="cool">Cool</option>
                    <option value="cold">Cold</option>
                  </select>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    Sales priority. Set it manually, or use Re-score below for
                    an AI recommendation.
                  </p>
                </div>
                <div className="crm-field">
                  <label>Work email</label>
                  <div>
                    <CrmTag kind={email.kind}>{email.label}</CrmTag>
                    <p className="mt-2 text-[11px] text-[var(--muted)]">
                      {primaryContact.data?.email ??
                        "Free search saved the lead without spending a credit."}
                    </p>
                    {!primaryContact.data?.email ? (
                      <Link
                        href="/crm/hunt#apollo-people-search"
                        className="mt-2 inline-block text-[11px] font-bold text-[var(--ochre-dark)] underline"
                      >
                        Return to Find clients to unlock this exact lead →
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="crm-approval-actions">
                <CrmBtn
                  variant="primary"
                  data-testid="deal-buaf-save"
                  disabled={update.isPending}
                  onClick={async () => {
                    await update.mutateAsync({
                      id,
                      buafBudget: budget,
                      buafUrgency: urgency,
                      buafAccess: access,
                      buafFit: fit,
                      buafTemperature: temp || null,
                    });
                    setActionStatus("Lead qualification saved.");
                  }}
                >
                  Save BUAF
                </CrmBtn>
              </div>
            </div>
          </div>

          <div className="crm-panel" data-testid="deal-needs">
            <div className="crm-panel-head">
              <div>
                <h3>What the client needs</h3>
                <p>
                  This snapshot becomes the proposal source. Saving a change
                  keeps the earlier version in the audit trail.
                </p>
              </div>
              <CrmTag kind={needsComplete ? "success" : "warn"}>
                {needsComplete
                  ? "Ready for proposal"
                  : savedNeeds
                    ? "Complete all four fields"
                    : "Needed before proposal"}
              </CrmTag>
            </div>
            <div className="crm-panel-body">
              <div className="crm-form-grid">
                <div className="crm-field wide">
                  <label htmlFor="deal-need-objective">Objective</label>
                  <input
                    id="deal-need-objective"
                    data-testid="deal-need-objective"
                    value={needObjective}
                    placeholder="What outcome does the client want?"
                    onChange={(event) => setNeedObjective(event.target.value)}
                  />
                </div>
                <div className="crm-field wide">
                  <label htmlFor="deal-need-deliverables">Deliverables</label>
                  <textarea
                    id="deal-need-deliverables"
                    data-testid="deal-need-deliverables"
                    value={needDeliverables}
                    placeholder="The concrete work HRMNY will deliver"
                    onChange={(event) =>
                      setNeedDeliverables(event.target.value)
                    }
                  />
                </div>
                <div className="crm-field">
                  <label htmlFor="deal-need-timing">Timing</label>
                  <input
                    id="deal-need-timing"
                    data-testid="deal-need-timing"
                    value={needTiming}
                    placeholder="Example: Live by 1 November"
                    onChange={(event) => setNeedTiming(event.target.value)}
                  />
                </div>
                <div className="crm-field">
                  <label htmlFor="deal-need-decision-maker">
                    Decision maker
                  </label>
                  <input
                    id="deal-need-decision-maker"
                    data-testid="deal-need-decision-maker"
                    value={needDecisionMaker}
                    placeholder={contactName ?? "Name and role"}
                    onChange={(event) =>
                      setNeedDecisionMaker(event.target.value)
                    }
                  />
                </div>
              </div>
              <div className="crm-approval-actions">
                <CrmBtn
                  variant="primary"
                  data-testid="deal-needs-save"
                  disabled={
                    addNote.isPending ||
                    ![
                      needObjective,
                      needDeliverables,
                      needTiming,
                      needDecisionMaker,
                    ].some((value) => value.trim())
                  }
                  onClick={async () => {
                    await addNote.mutateAsync({
                      dealId: id,
                      body: `SALES NEEDS — ${JSON.stringify({
                        objective: needObjective.trim(),
                        deliverables: needDeliverables.trim(),
                        timing: needTiming.trim(),
                        decisionMaker: needDecisionMaker.trim(),
                      })}`,
                    });
                    setActionStatus("Client needs snapshot saved.");
                  }}
                >
                  Save client needs
                </CrmBtn>
              </div>
            </div>
          </div>

          <AiDealPanel
            dealId={id}
            emailReady={email.label === "Verified"}
            knowledgeBrief={knowledgeBrief ?? null}
          />

          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Notes</h3>
                <p>Deal-scoped CRM notes</p>
              </div>
            </div>
            <div className="crm-panel-body">
              <div className="crm-composer">
                <textarea
                  placeholder="Add a note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <CrmBtn
                  variant="primary"
                  disabled={!note.trim() || addNote.isPending}
                  onClick={() =>
                    void addNote
                      .mutateAsync({ body: note.trim(), dealId: id })
                      .then(() => setNote(""))
                  }
                >
                  Save
                </CrmBtn>
              </div>
              <div className="crm-checklist">
                {regularNotes.map((n) => (
                  <div key={n.crmNoteId} className="crm-check-row">
                    {humanizeCrmBody(n.body)}
                    <span>{formatRelative(n.createdAt)}</span>
                  </div>
                ))}
                {regularNotes.length === 0 ? (
                  <p className="text-[11px] text-[var(--muted)]">
                    No notes yet.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Scope & pricing</h3>
                <p>
                  Build what the client will receive and the price they see.
                </p>
              </div>
            </div>
            <div className="crm-panel-body">
              <div className="crm-metric">
                <span className="crm-metric-label">Quote value</span>
                <strong>{formatAed(d.quoteValue)}</strong>
                <small>
                  {"marginPct" in d && d.marginPct
                    ? `Margin ${Number(d.marginPct).toFixed(1)}%`
                    : "Margin redacted for this role"}
                </small>
              </div>
              <div className="crm-checklist mt-3">
                <div className="crm-check-row">
                  Sector <span>{d.sector ?? "—"}</span>
                </div>
                <div className="crm-check-row">
                  Lane <span>{formatLane(d.leadSourceLane)}</span>
                </div>
                <div className="crm-check-row">
                  Updated <span>{formatRelative(d.updatedAt)}</span>
                </div>
              </div>
              <Link
                href={`/crm/quote?dealId=${id}`}
                className="mt-3 inline-block text-[var(--ochre-dark)] text-[11px] font-bold"
              >
                Build scope & client pricing →
              </Link>
            </div>
          </div>

          <div className="crm-panel">
            <div className="crm-panel-head">
              <div>
                <h3>Activity</h3>
                <p>Deal timeline</p>
              </div>
              <CrmBtn
                variant="ghost"
                onClick={() =>
                  void logActivity.mutateAsync({
                    type: "note",
                    subject: "Manual check-in",
                    dealId: id,
                    companyId: d.companyId,
                  })
                }
              >
                Log
              </CrmBtn>
            </div>
            <div className="crm-panel-body">
              <div className="crm-timeline">
                {(activities.data ?? []).map((a) => (
                  <div key={a.activityId} className="crm-timeline-item">
                    <span className="crm-timeline-dot" />
                    <div>
                      <h4>{a.subject ?? a.type}</h4>
                      <p>{humanizeCrmBody(a.body ?? a.type)}</p>
                    </div>
                    <time>{formatRelative(a.occurredAt)}</time>
                  </div>
                ))}
              </div>
              {(tasks.data ?? []).length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semiboldr text-[var(--muted)]">
                    Linked tasks
                  </p>
                  <div className="crm-checklist">
                    {(tasks.data ?? []).map((t) => (
                      <div key={t.crmTaskId} className="crm-check-row">
                        {t.title}
                        <span>{t.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
