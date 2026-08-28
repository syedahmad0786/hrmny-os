import {
  IntegrationMisconfiguredError,
  type N8nAdapter,
  type N8nExecutionStatus,
  type N8nHealthResult,
  type N8nProposeResult,
  type N8nTriggerResult,
  type N8nWorkflowSummary,
} from "../types";
import {
  getN8nWebhookUrlOverride,
  normalizeN8nBaseUrl,
  resolveN8nConfig,
  resolveN8nWebhookUrl,
  type N8nConfig,
} from "./config";
import { getN8nEventEntry, type N8nCrmEvent } from "./events";

export type N8nAdapterConfig = {
  baseUrl?: string;
  apiKey?: string;
  outboundWebhookSecret?: string;
  mode?: "mock" | "live";
  allowProductionTrigger?: boolean;
};

const MOCK_WORKFLOWS: N8nWorkflowSummary[] = [
  {
    id: "p4WIuhK2lsN0LYp5",
    name: "hrmny-deal-won",
    active: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  {
    id: "HznTdyP6qCMTOuKr",
    name: "hrmny-ticket-created",
    active: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  {
    id: "oMUncrBD2LmTm9Pv",
    name: "hrmny-ticket-triage-assist",
    active: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  {
    id: "SZVMW9n2GWDVWnZq",
    name: "hrmny-error-alert",
    active: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  {
    id: "ykJ8vfC1AqyvTy7L",
    name: "hrmny-gmail-send-gate",
    active: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
  {
    id: "tIhOqhKHBVu0FJfi",
    name: "hrmny-outreach-draft",
    active: true,
    updatedAt: "2026-07-17T00:00:00.000Z",
  },
];

function apiHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-N8N-API-KEY": apiKey,
  };
}

/** Live REST/webhook calls must not hang CI or the automations smoke button. */
export const N8N_FETCH_TIMEOUT_MS = 8_000;

function n8nFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(N8N_FETCH_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(url, { ...init, signal });
}

/** Mock n8n — no network; used when key absent or N8N_MODE=mock. */
export function createN8nMock(config: N8nAdapterConfig = {}): N8nAdapter {
  const resolved = resolveN8nConfig({ ...config, mode: "mock" });
  return createN8nClient(resolved, "mock");
}

/**
 * Live n8n Cloud REST + webhook triggers.
 * Requires N8N_API_KEY for list/status; triggers need allowProductionTrigger.
 */
export function createN8nLive(config: N8nAdapterConfig = {}): N8nAdapter {
  const resolved = resolveN8nConfig({ ...config, mode: "live" });
  if (!resolved.apiKey) {
    throw new IntegrationMisconfiguredError(
      "n8n",
      "N8N_MODE=live but N8N_API_KEY missing — fail loud",
    );
  }
  return createN8nClient({ ...resolved, mode: "live" }, "live");
}

export function createN8nStub(): N8nAdapter {
  return createN8nMock();
}

/** Prefer live when mode=live and key present; otherwise mock (no-op). */
export function createN8nAdapter(config: N8nAdapterConfig = {}): N8nAdapter {
  const resolved = resolveN8nConfig(config);
  if (resolved.mode === "live") {
    if (!resolved.apiKey) {
      throw new IntegrationMisconfiguredError(
        "n8n",
        "N8N_MODE=live but N8N_API_KEY missing — fail loud",
      );
    }
    return createN8nClient(resolved, "live");
  }
  return createN8nClient({ ...resolved, mode: "mock" }, "mock");
}

function createN8nClient(
  config: N8nConfig,
  runtime: "mock" | "live",
): N8nAdapter {
  const baseUrl = normalizeN8nBaseUrl(config.baseUrl);

  return {
    readonlyMode: runtime,
    baseUrl,

    async health(): Promise<N8nHealthResult> {
      if (runtime === "mock") {
        return {
          ok: true,
          mode: "mock",
          baseUrl,
          apiKeyConfigured: Boolean(config.apiKey),
          allowProductionTrigger: config.allowProductionTrigger,
          detail:
            "mock — webhook URL env works without API key; set N8N_API_KEY + N8N_MODE=live for live list/health",
        };
      }
      const apiKey = config.apiKey!;
      try {
        const res = await n8nFetch(`${baseUrl}/api/v1/workflows?limit=1`, {
          method: "GET",
          headers: apiHeaders(apiKey),
        });
        if (!res.ok) {
          return {
            ok: false,
            mode: "live",
            baseUrl,
            apiKeyConfigured: true,
            allowProductionTrigger: config.allowProductionTrigger,
            detail: `HTTP ${res.status}`,
          };
        }
        return {
          ok: true,
          mode: "live",
          baseUrl,
          apiKeyConfigured: true,
          allowProductionTrigger: config.allowProductionTrigger,
          detail: "reachable",
        };
      } catch (err) {
        return {
          ok: false,
          mode: "live",
          baseUrl,
          apiKeyConfigured: true,
          allowProductionTrigger: config.allowProductionTrigger,
          detail: err instanceof Error ? err.message : "network error",
        };
      }
    },

    async listWorkflows(): Promise<N8nWorkflowSummary[]> {
      if (runtime === "mock") {
        return MOCK_WORKFLOWS.map((w) => ({ ...w }));
      }
      const apiKey = config.apiKey!;
      const res = await n8nFetch(`${baseUrl}/api/v1/workflows?limit=50`, {
        method: "GET",
        headers: apiHeaders(apiKey),
      });
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "n8n",
          `listWorkflows failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          name: string;
          active?: boolean;
          updatedAt?: string;
        }>;
      };
      return (data.data ?? []).map((w) => ({
        id: String(w.id),
        name: w.name,
        active: Boolean(w.active),
        updatedAt: w.updatedAt,
      }));
    },

    async getExecutionStatus(executionId: string): Promise<N8nExecutionStatus> {
      if (runtime === "mock") {
        return {
          id: executionId,
          finished: true,
          status: "success",
          mode: "mock",
        };
      }
      const apiKey = config.apiKey!;
      const res = await n8nFetch(
        `${baseUrl}/api/v1/executions/${encodeURIComponent(executionId)}`,
        {
          method: "GET",
          headers: apiHeaders(apiKey),
        },
      );
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "n8n",
          `getExecutionStatus failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        id?: string | number;
        finished?: boolean;
        status?: string;
        mode?: string;
      };
      return {
        id: String(data.id ?? executionId),
        finished: Boolean(data.finished),
        status: data.status ?? "unknown",
        mode: data.mode,
      };
    },

    /**
     * Propose a webhook trigger — never fires production.
     * Used by automation-orchestrator before HITL approve.
     */
    async proposeWorkflow(input: {
      event: string;
      payload?: Record<string, unknown>;
    }): Promise<N8nProposeResult> {
      const entry = getN8nEventEntry(input.event as N8nCrmEvent);
      if (!entry) {
        return {
          proposed: false,
          event: input.event,
          reason: "unknown event — not in N8N_EVENT_MAP",
        };
      }
      const webhookUrl = resolveN8nWebhookUrl(baseUrl, entry.webhookPath);
      return {
        proposed: true,
        event: input.event,
        workflowName: entry.workflowName,
        webhookPath: entry.webhookPath,
        webhookUrl,
        requiresHitl: entry.requiresHitl,
        payload: input.payload ?? {},
        reason: "awaiting HITL / N8N_ALLOW_PRODUCTION_TRIGGER before fire",
      };
    },

    /**
     * Trigger webhook. Blocked unless allowProductionTrigger (HITL gate).
     * Mock without webhook URL override: stub execution (no network).
     * Live mode OR `N8N_WEBHOOK_*` override: real POST (no API key needed).
     */
    async triggerWebhook(input: {
      webhookPath: string;
      payload?: Record<string, unknown>;
      allowProductionTrigger?: boolean;
    }): Promise<N8nTriggerResult> {
      const allowed =
        input.allowProductionTrigger === true || config.allowProductionTrigger;
      if (!allowed) {
        return {
          triggered: false,
          mode: runtime,
          blocked: true,
          reason:
            "HITL: set allowProductionTrigger or N8N_ALLOW_PRODUCTION_TRIGGER=true",
        };
      }

      const path = input.webhookPath.replace(/^\/+/, "");
      const url = resolveN8nWebhookUrl(baseUrl, path);
      const hasUrlOverride = Boolean(getN8nWebhookUrlOverride(path));
      const hitNetwork = runtime === "live" || hasUrlOverride;

      if (!hitNetwork) {
        return {
          triggered: true,
          mode: "mock",
          blocked: false,
          executionId: `mock-exec-${Date.now()}`,
          webhookUrl: url,
          reason: "mock fire — no network (set N8N_WEBHOOK_* or N8N_MODE=live)",
        };
      }

      if (!config.outboundWebhookSecret) {
        throw new IntegrationMisconfiguredError(
          "n8n",
          "N8N_OUTBOUND_WEBHOOK_SECRET is required before an OS-to-n8n webhook can fire",
        );
      }

      const res = await n8nFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hrmny-Os-Secret": config.outboundWebhookSecret,
        },
        body: JSON.stringify(input.payload ?? {}),
      });
      if (!res.ok) {
        return {
          triggered: false,
          mode: runtime === "live" ? "live" : "mock",
          blocked: false,
          webhookUrl: url,
          reason: `HTTP ${res.status}`,
        };
      }
      let executionId: string | undefined;
      try {
        const body = (await res.json()) as { executionId?: string; id?: string };
        executionId = body.executionId ?? body.id;
      } catch {
        /* webhook may return empty */
      }
      return {
        triggered: true,
        mode: runtime === "live" ? "live" : "mock",
        blocked: false,
        executionId,
        webhookUrl: url,
        reason: hasUrlOverride
          ? "fired via N8N_WEBHOOK_* URL override (no API key)"
          : undefined,
      };
    },
  };
}
