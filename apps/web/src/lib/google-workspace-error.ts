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

export function googleWorkspaceGmailApiEnableUrl(
  error: string | null | undefined,
): string | null {
  if (
    !error ||
    !/gmail api/i.test(error) ||
    !/disabled|has not been used/i.test(error)
  ) {
    return null;
  }
  const project = /\bproject\s+(\d{6,})\b/i.exec(error)?.[1];
  const url = new URL(
    "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  );
  if (project) url.searchParams.set("project", project);
  return url.toString();
}

export function formatGoogleWorkspaceGmailError(
  status: number,
  detail: string,
): string {
  if (
    status === 403 &&
    /gmail api/i.test(detail) &&
    /disabled|has not been used/i.test(detail)
  ) {
    const project = /\bproject\s+(\d{6,})\b/i.exec(detail)?.[1];
    return `Gmail API is disabled${project ? ` for Google Cloud project ${project}` : ""}. Enable it, then retry; no email was sent.`;
  }
  return `Google Workspace Gmail request failed (${status}): ${detail.slice(0, 200)}`;
}
