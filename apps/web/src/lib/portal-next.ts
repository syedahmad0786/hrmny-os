/**
 * Safe post-verify destinations for portal magic links.
 * Client + server shared — keep free of Node-only imports.
 */

const PORTAL_NEXT_PREFIX = "/portal";

/**
 * Allowlist relative /portal/* paths (optional query). Rejects open redirects.
 */
export function sanitizePortalNextPath(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith(PORTAL_NEXT_PREFIX)) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.includes("://") || trimmed.includes("\\")) return null;
  if (trimmed.includes("..")) return null;

  try {
    const parsed = new URL(trimmed, "https://hrmny.invalid");
    if (!parsed.pathname.startsWith(PORTAL_NEXT_PREFIX)) return null;
    if (parsed.pathname.includes("..")) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/** Append allowlisted `next` to a verify path (or any URL path+query). */
export function withPortalNext(
  portalPath: string,
  next: string | null | undefined,
): string {
  const safe = sanitizePortalNextPath(next);
  if (!safe) return portalPath;
  const sep = portalPath.includes("?") ? "&" : "?";
  return `${portalPath}${sep}next=${encodeURIComponent(safe)}`;
}
