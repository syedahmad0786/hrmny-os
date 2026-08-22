/**
 * Extract clickable OS deep links from agent tool payloads (`next.*`, portalPath).
 * Shared by Delivery and Settings → AI so "run on command" surfaces the same CTAs.
 */

export type AgentNextLink = { href: string; label: string };

export function nextLinksFromToolData(data: unknown): AgentNextLink[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const links: AgentNextLink[] = [];
  const next = record.next;
  if (next && typeof next === "object") {
    for (const [key, value] of Object.entries(
      next as Record<string, unknown>,
    )) {
      if (typeof value === "string" && value.startsWith("/")) {
        links.push({ href: value, label: key });
      }
    }
  }
  if (
    typeof record.portalPath === "string" &&
    record.portalPath.startsWith("/")
  ) {
    links.push({ href: record.portalPath, label: "portal" });
  }
  return links;
}

/** Flatten next links from a list of tool result rows. */
export function nextLinksFromToolResults(
  rows: Array<{ data?: unknown } | null | undefined> | null | undefined,
): AgentNextLink[] {
  if (!rows?.length) return [];
  const seen = new Set<string>();
  const out: AgentNextLink[] = [];
  for (const row of rows) {
    for (const link of nextLinksFromToolData(row?.data)) {
      const key = `${link.label}:${link.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}
