import { isPrunableTestAgentSlug } from "./test-agent-slugs";

const SYNTHETIC_NAME_PATTERNS = [
  /^e2e\b/i,
  /^live proof\b/i,
  /^inbound proof\b/i,
  /^closed loop\b/i,
  /^demo\b/i,
  /^other co\b/i,
  /^handover smoke\b/i,
  /^invite proof\b/i,
  /^memory prospect\b/i,
  /^apollo unit\b/i,
  /^m\d[- ]proof\b/i,
  /^personal\s+\d{10,}\b/i,
  /^user-only note\b/i,
  /^run demo\b/i,
  /^unit demo\b/i,
  /^fixture co\b/i,
  /^acme(?:\s+llc)?$/i,
  /^test brand(?:\s+llc)?$/i,
  /^uae hospitality brands$/i,
  /^(?:uae retail brand|portal|campaign|creative|outreach|finance|agent)$/i,
  /^(?:marketingagencyprospectsuae|fintechdubai)(?:\s+llc)?$/i,
  /^(?:presentation client|race co|rename co|cost co|drop co|merge co|new prospect)$/i,
  /^m1 production acceptance\b/i,
  /^ui e2e\b/i,
  /^\[agent\](?:\s|$)/i,
] as const;

const SYNTHETIC_ADDRESS_PATTERNS = [
  /@example\.(?:com|test|invalid)$/i,
  /@example\.org$/i,
  /@[^@\s]+\.example$/i,
] as const;

const SYNTHETIC_AGENT_PATTERNS = [
  /^chat-bind-/i,
  /^e2e-tools-/i,
  /^e2e-coach-/i,
  /^staff-iso-/i,
  /^am-blocked-/i,
  /^funnel-repair-/i,
  /^funnel-only-/i,
  /^os-settle-[a-z0-9]+$/i,
  /^brand-voice-[a-z0-9]+$/i,
] as const;

/** Known automated-fixture names. They remain stored for audit and testing. */
export function isSyntheticRecordName(
  value: string | null | undefined,
): boolean {
  // ponytail: legacy rows have no durable class; replace this name heuristic with
  // reviewed operational/synthetic/quarantined classification when its migration is approved.
  const name = value?.trim() ?? "";
  return (
    Boolean(name) &&
    SYNTHETIC_NAME_PATTERNS.some((pattern) => pattern.test(name))
  );
}

/** Known fixture markers across names, titles, and recipient addresses. */
export function hasSyntheticMarker(
  ...values: Array<string | null | undefined>
): boolean {
  return values.some((value) => {
    const normalized = value?.trim() ?? "";
    return (
      isSyntheticRecordName(normalized) ||
      SYNTHETIC_ADDRESS_PATTERNS.some((pattern) => pattern.test(normalized))
    );
  });
}

export function isSyntheticAgent(input: {
  slug?: string | null;
  displayName?: string | null;
}): boolean {
  const slug = input.slug?.trim() ?? "";
  if (slug && isPrunableTestAgentSlug(slug)) return true;
  if (SYNTHETIC_AGENT_PATTERNS.some((pattern) => pattern.test(slug)))
    return true;
  return /^proof agent$/i.test(input.displayName?.trim() ?? "");
}

export function isSyntheticChatThread(input: {
  title?: string | null;
  agentSlug?: string | null;
  clientName?: string | null;
}): boolean {
  return (
    isSyntheticRecordName(input.title) ||
    isSyntheticRecordName(input.clientName) ||
    isSyntheticAgent({ slug: input.agentSlug })
  );
}
