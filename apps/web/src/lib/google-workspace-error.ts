/** True when Heal / token refresh cannot recover — staff must Reconnect. */
export function isGoogleWorkspaceReconnectRequired(
  lastError: string | null | undefined,
): boolean {
  if (!lastError?.trim()) return false;
  const t = lastError.toLowerCase();
  return (
    t.includes("invalid_grant") ||
    t.includes("revoked") ||
    t.includes("expired or revoked") ||
    t.includes("token has been expired") ||
    t.includes("token has been revoked")
  );
}
