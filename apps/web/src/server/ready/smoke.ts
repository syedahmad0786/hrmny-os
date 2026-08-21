import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type ReadyConnectionBucket = {
  googleWorkspace: number;
  canva: number;
  linkedin: number;
  xero: number;
  errors: {
    googleWorkspace: number;
    canva: number;
    linkedin: number;
    xero: number;
  };
  /** Latest last_error snippet per toolkit (no secrets). */
  lastErrors: {
    googleWorkspace: string | null;
    canva: string | null;
    linkedin: string | null;
    xero: string | null;
  };
};

export type ReadyToolsSlice = {
  apollo?: string;
  hunter?: string;
  xero?: string;
  resend?: string;
};

const emptyConnections = (): ReadyConnectionBucket => ({
  googleWorkspace: 0,
  canva: 0,
  linkedin: 0,
  xero: 0,
  errors: {
    googleWorkspace: 0,
    canva: 0,
    linkedin: 0,
    xero: 0,
  },
  lastErrors: {
    googleWorkspace: null,
    canva: null,
    linkedin: null,
    xero: null,
  },
});

function bucketForToolkit(
  toolkit: string,
): keyof Omit<ReadyConnectionBucket, "errors" | "lastErrors"> | null {
  if (toolkit === "google_workspace") return "googleWorkspace";
  if (toolkit === "xero") return "xero";
  if (toolkit === "canva" || toolkit === "composio:canva") return "canva";
  if (toolkit === "linkedin" || toolkit === "composio:linkedin")
    return "linkedin";
  return null;
}

/** Connected / error counts + latest last_error snippets (no secrets). */
export async function connectionSmoke(): Promise<ReadyConnectionBucket> {
  const empty = emptyConnections();
  const db = getDb();
  if (!db) return empty;
  try {
    const rows = await db.execute<{
      toolkit: string;
      status: string;
      n: number;
    }>(sql`
      select toolkit, status, count(*)::int as n
      from public.connection_account
      where status in ('connected', 'error')
        and toolkit in (
          'google_workspace',
          'canva',
          'linkedin',
          'xero',
          'composio:canva',
          'composio:linkedin'
        )
      group by toolkit, status
    `);
    const counts = emptyConnections();
    for (const row of rows) {
      const n = Number(row.n) || 0;
      const bucket = bucketForToolkit(row.toolkit);
      if (!bucket) continue;
      if (row.status === "connected") counts[bucket] += n;
      else if (row.status === "error") counts.errors[bucket] += n;
    }

    const errRows = await db.execute<{
      toolkit: string;
      lastError: string | null;
    }>(sql`
      select distinct on (toolkit)
        toolkit,
        last_error as "lastError"
      from public.connection_account
      where status = 'error'
        and toolkit in (
          'google_workspace',
          'canva',
          'linkedin',
          'xero',
          'composio:canva',
          'composio:linkedin'
        )
        and last_error is not null
        and length(trim(last_error)) > 0
      order by toolkit, updated_at desc
    `);
    for (const row of errRows) {
      const bucket = bucketForToolkit(row.toolkit);
      if (!bucket || !row.lastError) continue;
      const snippet = row.lastError.slice(0, 240);
      // Prefer native toolkit rows over composio: aliases.
      if (
        counts.lastErrors[bucket] &&
        row.toolkit.startsWith("composio:")
      ) {
        continue;
      }
      counts.lastErrors[bucket] = snippet;
    }
    return counts;
  } catch {
    return empty;
  }
}

/**
 * Human-actionable live-demo blockers derived from ready smoke.
 * Pure — shared by /api/ready and staff UIs.
 */
export function buildDemoBlockers(input: {
  tools: ReadyToolsSlice;
  connections: Pick<
    ReadyConnectionBucket,
    "googleWorkspace" | "canva" | "linkedin" | "xero" | "errors" | "lastErrors"
  >;
}): string[] {
  const { tools, connections } = input;
  const blockers: string[] = [];

  if (tools.apollo === "mock") {
    blockers.push("Paste Apollo API key in Connections");
  }
  if (tools.hunter === "mock") {
    blockers.push("Paste Hunter API key in Connections");
  }
  if (tools.xero === "mock" || connections.xero < 1) {
    blockers.push("Connect Xero OAuth in Connections");
  }
  if (connections.googleWorkspace < 1) {
    const err = connections.lastErrors.googleWorkspace?.trim();
    if (err) {
      blockers.push(`Reconnect Google Workspace: ${err}`);
    } else if (connections.errors.googleWorkspace > 0) {
      blockers.push(
        "Reconnect Google Workspace (token revoked) for live HITL Gmail",
      );
    } else {
      blockers.push("Reconnect Google Workspace for live HITL Gmail");
    }
  }
  if (connections.linkedin < 1) {
    const err = connections.lastErrors.linkedin?.trim();
    blockers.push(
      err
        ? `Connect LinkedIn (Composio): ${err}`
        : "Connect LinkedIn (Composio) for campaign publish",
    );
  }
  if (connections.canva < 1) {
    const err = connections.lastErrors.canva?.trim();
    blockers.push(
      err
        ? `Connect Canva (Composio): ${err}`
        : "Connect Canva (Composio) for design → portal",
    );
  }
  if (tools.resend && tools.resend !== "live") {
    blockers.push(
      tools.resend === "configured"
        ? "Resend key present — set RESEND_MODE=live (+ RESEND_FROM) for real portal email"
        : "Set RESEND_MODE=live + RESEND_API_KEY + RESEND_FROM for real portal email",
    );
  }
  return blockers;
}
