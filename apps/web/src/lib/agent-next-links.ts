/**
 * Extract clickable OS deep links from agent tool payloads (`next.*`, portal
 * magic paths). Shared by Delivery, Settings → AI, and Chat so "run on command"
 * surfaces the same CTAs.
 */

export type AgentNextLink = { href: string; label: string };

function pushPath(
  links: AgentNextLink[],
  seen: Set<string>,
  href: unknown,
  label: string,
) {
  if (typeof href !== "string" || !href.startsWith("/")) return;
  const key = `${label}:${href}`;
  if (seen.has(key)) return;
  seen.add(key);
  links.push({ href, label });
}

export function nextLinksFromToolData(data: unknown): AgentNextLink[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const links: AgentNextLink[] = [];
  const seen = new Set<string>();
  const next = record.next;
  if (next && typeof next === "object") {
    for (const [key, value] of Object.entries(
      next as Record<string, unknown>,
    )) {
      pushPath(links, seen, value, key);
    }
  }
  pushPath(links, seen, record.portalPath, "portal");
  // creative.sendToPortal / funnel assets mint this field (not portalPath).
  pushPath(links, seen, record.portalHref, "portal");
  const invite = record.portalInvite;
  if (invite && typeof invite === "object") {
    const inv = invite as Record<string, unknown>;
    pushPath(links, seen, inv.portalPath, "portal");
    pushPath(links, seen, inv.onboardingPath, "onboarding");
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

/**
 * Chat harness stores observations as JSON strings, typically
 * `{ tools: [{ tool, ok, data }] }` for agent_act / funnel_act.
 * Prefer a leading `nextLinks` array when present (survives 4k truncation).
 */
export function nextLinksFromChatObservation(
  observation: unknown,
): AgentNextLink[] {
  let parsed: unknown = observation;
  if (typeof observation === "string") {
    const trimmed = observation.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      // Truncated JSON is common (harness slices to 4k). Recover a leading
      // nextLinks array when the payload was cut mid-tools.
      const m = trimmed.match(
        /"nextLinks"\s*:\s*(\[\s*(?:\{[^\]]*\}|\s|,)*\])/,
      );
      if (m?.[1]) {
        try {
          const links = JSON.parse(m[1]) as unknown;
          if (Array.isArray(links)) {
            return links.filter(
              (l): l is AgentNextLink =>
                !!l &&
                typeof l === "object" &&
                typeof (l as AgentNextLink).href === "string" &&
                typeof (l as AgentNextLink).label === "string" &&
                (l as AgentNextLink).href.startsWith("/"),
            );
          }
        } catch {
          /* fall through */
        }
      }
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.nextLinks)) {
    const fromMeta = record.nextLinks.filter(
      (l): l is AgentNextLink =>
        !!l &&
        typeof l === "object" &&
        typeof (l as AgentNextLink).href === "string" &&
        typeof (l as AgentNextLink).label === "string" &&
        (l as AgentNextLink).href.startsWith("/"),
    );
    if (fromMeta.length) return fromMeta;
  }
  if (Array.isArray(record.tools)) {
    return nextLinksFromToolResults(
      record.tools as Array<{ data?: unknown }>,
    );
  }
  return nextLinksFromToolData(parsed);
}
