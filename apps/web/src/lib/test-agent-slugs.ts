/** Slugs auto-created by vitest / Playwright — safe to bulk-remove before demos. */
const PRUNABLE_TEST_SLUG_PREFIXES = [
  "proof-agent-",
  "e2e-cmd-",
  "e2e-os-",
] as const;

/** Seeded product agents — never prune. */
const PROTECTED_AGENT_SLUGS = new Set(["delivery-coach", "os-settle"]);

export function isPrunableTestAgentSlug(slug: string): boolean {
  const s = slug.trim();
  if (!s || PROTECTED_AGENT_SLUGS.has(s)) return false;
  return PRUNABLE_TEST_SLUG_PREFIXES.some((prefix) => s.startsWith(prefix));
}
