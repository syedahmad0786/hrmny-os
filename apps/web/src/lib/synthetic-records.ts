import { isPrunableTestAgentSlug } from "./test-agent-slugs";

const SYNTHETIC_NAME_PATTERNS = [
  /^e2e\b/i,
  /^live proof\b/i,
  /^inbound proof\b/i,
  /^closed loop\b/i,
  /^demo funnel\b/i,
  /^handover smoke\b/i,
  /^invite proof\b/i,
  /^memory prospect\b/i,
  /^demo hunt\b/i,
  /^apollo unit\b/i,
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
  const name = value?.trim() ?? "";
  return (
    Boolean(name) &&
    SYNTHETIC_NAME_PATTERNS.some((pattern) => pattern.test(name))
  );
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
