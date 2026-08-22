/** Shape of `/api/ready` — no secrets. Shared by Hunt, Connections, and staff UIs. */
export type ReadySmoke = {
  ok?: boolean;
  authMode?: string;
  llmProvider?: string;
  llmDefaultModel?: string;
  llmFreeOnly?: boolean;
  xeroWriteEnabled?: boolean;
  database?: "up" | "down";
  pgvector?: boolean;
  portalMagicLink?: string;
  tools?: Record<string, string>;
  blockers?: string[];
  connections?: {
    googleWorkspace?: number;
    canva?: number;
    linkedin?: number;
    xero?: number;
    errors?: {
      googleWorkspace?: number;
      canva?: number;
      linkedin?: number;
      xero?: number;
    };
    lastErrors?: {
      googleWorkspace?: string | null;
      canva?: string | null;
      linkedin?: string | null;
      xero?: string | null;
    };
  };
};

export function formatReadyLlmLine(ready: ReadySmoke): string {
  const provider = ready.llmProvider ?? "—";
  const model = ready.llmDefaultModel ?? "—";
  const free = ready.llmFreeOnly ? " · free routes only" : "";
  return `${provider} · ${model}${free}`;
}

export function formatReadyDbLine(ready: ReadySmoke): string {
  const db = ready.database ?? "—";
  const vec = ready.pgvector ? "on" : "off";
  const portal = ready.portalMagicLink ?? "—";
  return `database ${db} · pgvector ${vec} · portal magic-link ${portal}`;
}

export function formatReadyToolsLine(ready: ReadySmoke): string {
  const t = ready.tools ?? {};
  const keys = ["n8n", "apollo", "hunter", "openrouter", "resend"] as const;
  return keys.map((k) => `${k} ${t[k] ?? "—"}`).join(" · ");
}
