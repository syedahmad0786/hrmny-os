/** Map /api/ready blocker copy → Connections in-page anchor hash. */
export function demoBlockerAnchor(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("apollo")) return "#conn-apollo";
  if (t.includes("hunter")) return "#conn-hunter";
  if (t.includes("xero")) return "#conn-xero";
  if (t.includes("google workspace") || t.includes("googleworkspace")) {
    return "#conn-google_workspace";
  }
  if (t.includes("linkedin")) return "#conn-linkedin";
  if (t.includes("canva")) return "#conn-canva";
  if (t.includes("resend")) return "#direct-business-connections";
  return null;
}

export function demoBlockerConnectionsPath(text: string): string | null {
  const anchor = demoBlockerAnchor(text);
  return anchor ? `/settings/connections${anchor}` : null;
}
