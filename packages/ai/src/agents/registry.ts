import { z } from "zod";

/**
 * Multi-agent CRM / OS roster — stubs only.
 * Orchestration: retrieve memory → draft → HITL approve → (optional) send via gate.
 * NEVER auto-send email/LinkedIn; NEVER unattended paid creative spend; NEVER invent payroll.
 *
 * Human-readable manuals (stubs): `./<agentId>/instructions.md`
 * Runtime / SoT / crons: `hrmny_OS_Execution/12-AGENTS-RUNTIME-AND-STORAGE.md`
 */

export const AgentIdSchema = z.enum([
  "research",
  "outreach-draft",
  "delivery-qc",
  "finance-assist",
  "portal-concierge",
  "hr",
  "creative",
  "canva",
  "midjourney",
  "higgsfield",
  "automation-orchestrator",
  "error-monitor",
  "ticket-assist",
]);

export type AgentId = z.infer<typeof AgentIdSchema>;

/** Parent agents only (excludes creative children). */
export const ParentAgentIdSchema = z.enum([
  "research",
  "outreach-draft",
  "delivery-qc",
  "finance-assist",
  "portal-concierge",
  "hr",
  "creative",
  "automation-orchestrator",
  "error-monitor",
  "ticket-assist",
]);

export type ParentAgentId = z.infer<typeof ParentAgentIdSchema>;

export const CreativeSubagentIdSchema = z.enum([
  "canva",
  "midjourney",
  "higgsfield",
]);

export type CreativeSubagentId = z.infer<typeof CreativeSubagentIdSchema>;

export type AgentDefinition = {
  id: AgentId;
  displayName: string;
  responsibility: string;
  /** May create draft payloads that require human approve */
  producesDrafts: boolean;
  /** Hard lock: outbound / spend / client-visible never unattended */
  requiresHitlBeforeSend: true;
  allowedTools: string[];
  /** When set, this entry is a child of another agent (e.g. creative tools). */
  parentId?: ParentAgentId;
};

export const AGENT_REGISTRY: Record<AgentId, AgentDefinition> = {
  research: {
    id: "research",
    displayName: "Research",
    responsibility:
      "Enrich company/contact context from Apollo/Hunter/notes; write briefs + memory chunks.",
    producesDrafts: false,
    requiresHitlBeforeSend: true,
    allowedTools: ["apollo", "hunter", "memory.retrieve", "memory.upsert"],
  },
  "outreach-draft": {
    id: "outreach-draft",
    displayName: "Outreach draft",
    responsibility:
      "Draft email/LinkedIn copy from deal + memory. LinkedIn = copy-only. Email send = HITL.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: ["memory.retrieve", "composio.draft", "linkedin.copy"],
  },
  "delivery-qc": {
    id: "delivery-qc",
    displayName: "Delivery QC",
    responsibility:
      "Check deliverables/briefs against conventions; flag gaps before client send.",
    producesDrafts: false,
    requiresHitlBeforeSend: true,
    allowedTools: ["memory.retrieve", "conventions.read", "gate.qc"],
  },
  "finance-assist": {
    id: "finance-assist",
    displayName: "Finance assist",
    responsibility:
      "Propose invoice extracts / VAT holds; never post to Xero without human approve + gate.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: ["invoice.extract", "memory.retrieve", "gate.invoice"],
  },
  "portal-concierge": {
    id: "portal-concierge",
    displayName: "Portal concierge",
    responsibility:
      "Answer portal questions from client-scoped docs/memory; email replies need HITL.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: ["memory.retrieve", "portal.scope", "composio.draft"],
  },
  hr: {
    id: "hr",
    displayName: "HR",
    responsibility:
      "Leave / onboarding / Bayzat-CSV seam assists. Never invent payroll figures; never write Bayzat master; payroll proposes need HITL + gate.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: [
      "bayzat.mirror.read",
      "bayzat.csv.import",
      "employees.lifecycle",
      "memory.retrieve",
      "gate.payroll",
    ],
  },
  creative: {
    id: "creative",
    displayName: "Creative",
    responsibility:
      "Parent for creative briefs/tool jobs. Produces copy drafts, job specs, asset briefs — not unattended generation spend. Children: canva, midjourney, higgsfield.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: [
      "memory.retrieve",
      "creative.brief",
      "creative.jobSpec",
      "canva.connect",
      "midjourney.prompt",
      "higgsfield.prompt",
    ],
  },
  canva: {
    id: "canva",
    displayName: "Canva",
    parentId: "creative",
    responsibility:
      "Canva connect-only: open/create via connected account; never clone Canva UI. Draft asset briefs + design job specs for human.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: ["canva.connect", "creative.brief", "memory.retrieve"],
  },
  midjourney: {
    id: "midjourney",
    displayName: "Midjourney",
    parentId: "creative",
    responsibility:
      "Brief + prompt generator + webhook/status stubs. Human starts paid runs; no unattended Midjourney spend.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: [
      "midjourney.prompt",
      "midjourney.statusStub",
      "creative.brief",
      "memory.retrieve",
    ],
  },
  higgsfield: {
    id: "higgsfield",
    displayName: "Higgsfield",
    parentId: "creative",
    responsibility:
      "Generative creative tool seam (Higgsfield / similar): brief + prompt + job-status stubs. No unattended paid generation.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: [
      "higgsfield.prompt",
      "higgsfield.statusStub",
      "creative.brief",
      "memory.retrieve",
    ],
  },
  "automation-orchestrator": {
    id: "automation-orchestrator",
    displayName: "Automation orchestrator",
    responsibility:
      "Propose / trigger n8n workflows; map CRM events → n8n. Target: https://hrmny.app.n8n.cloud (N8N_BASE_URL / N8N_API_KEY in env — never commit keys). Client: @hrmny/integrations n8n adapter; tRPC automation.*.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: [
      "n8n.propose",
      "n8n.trigger",
      "n8n.listWorkflows",
      "crm.events.map",
      "memory.retrieve",
    ],
  },
  "error-monitor": {
    id: "error-monitor",
    displayName: "Error monitoring",
    responsibility:
      "Watch Inngest/job failures + integration health; draft alerts to Chat/Slack. Humans confirm noise vs page.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: [
      "inngest.failures",
      "integrations.health",
      "health.signal",
      "chat.alertDraft",
      "slack.alertDraft",
    ],
  },
  "ticket-assist": {
    id: "ticket-assist",
    displayName: "Ticket assist",
    responsibility:
      "Classify / prioritize tickets, suggest assignee, draft replies. Client-visible replies require human approve.",
    producesDrafts: true,
    requiresHitlBeforeSend: true,
    allowedTools: [
      "tickets.classify",
      "tickets.prioritize",
      "tickets.suggestAssignee",
      "tickets.draftReply",
      "memory.retrieve",
    ],
  },
};

export function getAgent(id: AgentId): AgentDefinition {
  return AGENT_REGISTRY[id];
}

// --- Kill switch ---------------------------------------------------------
// `AGENT_DISABLED_LIST` (comma-separated agent ids) seeds the disabled set at
// boot; `setAgentEnabled` layers per-process runtime overrides on top (what the
// ai-admin toggle drives). ponytail: process-local, not durable across
// restarts — promote to an agent_settings table if a persisted toggle is needed.

const runtimeOverrides = new Map<AgentId, boolean>();

function envDisabledIds(): Set<string> {
  return new Set(
    (process.env.AGENT_DISABLED_LIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isAgentEnabled(id: AgentId): boolean {
  const override = runtimeOverrides.get(id);
  if (override !== undefined) return override;
  return !envDisabledIds().has(id);
}

export function setAgentEnabled(id: AgentId, enabled: boolean): void {
  runtimeOverrides.set(id, enabled);
}

/** Drop all runtime overrides, reverting every agent to its env-list default. */
export function resetAgentOverrides(): void {
  runtimeOverrides.clear();
}

export type AgentRefusal = {
  ok: false;
  refused: true;
  agentId: AgentId;
  reason: "agent_disabled";
  message: string;
};

/** Typed refusal for a disabled agent — callers return this, never throw. */
export function agentDisabledRefusal(id: AgentId): AgentRefusal {
  return {
    ok: false,
    refused: true,
    agentId: id,
    reason: "agent_disabled",
    message: `Agent "${id}" is disabled by the kill switch.`,
  };
}

/** Enabled-state snapshot for every agent — feeds the admin panel. */
export function agentEnabledStates(): Array<{ id: AgentId; enabled: boolean }> {
  return AgentIdSchema.options.map((id) => ({ id, enabled: isAgentEnabled(id) }));
}

export function listAgents(): AgentDefinition[] {
  return Object.values(AGENT_REGISTRY);
}

/** Top-level roster (excludes creative subagents). */
export function listParentAgents(): AgentDefinition[] {
  return listAgents().filter((a) => !a.parentId);
}

export function listCreativeSubagents(): AgentDefinition[] {
  return CreativeSubagentIdSchema.options.map((id) => AGENT_REGISTRY[id]);
}

/**
 * Orchestration contract note (enforced in apps/web + gate, not here):
 * 1) retrieveMemory
 * 2) agent draft
 * 3) human approve in HITL queue
 * 4) gate authorize → send adapter (email) OR clipboard (LinkedIn) OR paid creative run
 */
export const ORCHESTRATION_HITL_NOTE =
  "V1: agents stop at draft. packages/gate + HITL queue required before any external send, payroll invent, or paid creative spend." as const;
