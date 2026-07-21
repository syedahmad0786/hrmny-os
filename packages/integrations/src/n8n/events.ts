/**
 * CRM / OS events → n8n webhook path stubs.
 * Paths are relative to webhook base: `{N8N_BASE_URL}/webhook/{path}`
 * Workflow names match `11-N8N-SETUP.md` templates.
 */

export type N8nCrmEvent =
  | "deal.won"
  | "ticket.created"
  | "ticket.updated"
  | "memory.ingest"
  | "error.alert"
  | "creative.brief.dispatch"
  | "outreach.draft";

export type N8nEventMapEntry = {
  event: N8nCrmEvent;
  /** Suggested n8n workflow name (create in cloud UI). */
  workflowName: string;
  /** Webhook path segment after /webhook/ */
  webhookPath: string;
  /** automation-orchestrator must propose first; trigger needs HITL. */
  requiresHitl: boolean;
};

export const N8N_EVENT_MAP: readonly N8nEventMapEntry[] = [
  {
    event: "deal.won",
    workflowName: "hrmny-deal-won",
    webhookPath: "hrmny-deal-won",
    requiresHitl: true,
  },
  {
    event: "ticket.created",
    workflowName: "hrmny-ticket-created",
    webhookPath: "hrmny-ticket-created",
    requiresHitl: true,
  },
  {
    event: "ticket.updated",
    workflowName: "hrmny-ticket-triage-assist",
    webhookPath: "hrmny-ticket-triage-assist",
    requiresHitl: true,
  },
  {
    event: "memory.ingest",
    workflowName: "hrmny-memory-ingest",
    webhookPath: "hrmny-memory-ingest",
    requiresHitl: true,
  },
  {
    event: "error.alert",
    workflowName: "hrmny-error-alert",
    webhookPath: "hrmny-error-alert",
    requiresHitl: true,
  },
  {
    event: "creative.brief.dispatch",
    workflowName: "hrmny-creative-brief-dispatch",
    webhookPath: "hrmny-creative-brief-dispatch",
    requiresHitl: true,
  },
  {
    event: "outreach.draft",
    workflowName: "hrmny-outreach-draft",
    webhookPath: "hrmny-outreach-draft",
    requiresHitl: true,
  },
] as const;

export function getN8nEventEntry(
  event: N8nCrmEvent,
): N8nEventMapEntry | undefined {
  return N8N_EVENT_MAP.find((e) => e.event === event);
}

export function mapCrmEventToWebhookPath(event: N8nCrmEvent): string | null {
  return getN8nEventEntry(event)?.webhookPath ?? null;
}
