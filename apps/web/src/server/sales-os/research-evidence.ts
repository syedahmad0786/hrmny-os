const RESERVED_EVIDENCE_HOSTS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

const RESERVED_EVIDENCE_SUFFIXES = [
  "example.com",
  "example.net",
  "example.org",
] as const;

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && b !== undefined && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a !== undefined && a >= 224)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89ab]/.test(value) ||
    value.startsWith("::ffff:") ||
    value.startsWith("2001:db8:")
  );
}

export class ResearchEvidenceError extends Error {
  readonly code = "RESEARCH_EVIDENCE_REQUIRED";

  constructor(
    message = "A verified HTTPS source is required before research review",
  ) {
    super(message);
    this.name = "ResearchEvidenceError";
  }
}

/**
 * Normalize an operator-supplied source without fetching it. Operational
 * research cannot cite test, loopback, or placeholder hosts as evidence.
 */
export function normalizeResearchEvidence(
  value: string | null | undefined,
): string {
  const raw = value?.trim();
  if (!raw) throw new ResearchEvidenceError();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ResearchEvidenceError(
      "Research evidence must be a valid HTTPS URL",
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isReserved =
    RESERVED_EVIDENCE_HOSTS.has(hostname) ||
    RESERVED_EVIDENCE_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    ) ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".test") ||
    isPrivateIpv4(hostname) ||
    isPrivateIpv6(hostname);
  if (
    url.protocol !== "https:" ||
    !hostname ||
    url.username ||
    url.password ||
    isReserved
  ) {
    throw new ResearchEvidenceError(
      "Research evidence must use a non-placeholder public HTTPS source",
    );
  }

  url.hash = "";
  return url.toString();
}

export function normalizeResearchCompanyName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeResearchWebsiteHost(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
