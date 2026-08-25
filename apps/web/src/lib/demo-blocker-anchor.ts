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

/** Apollo / Hunter / Xero / social / Resend can wait — mailbox send cannot. */
export function isOptionalLaterDemoBlocker(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("apollo") ||
    t.includes("hunter") ||
    t.includes("xero") ||
    t.includes("linkedin") ||
    t.includes("canva") ||
    t.includes("resend")
  );
}

/** Google Workspace first so staff see the mailbox reconnect before optional keys. */
export function prioritizeDemoBlockers(items: string[]): string[] {
  return [...items].sort((a, b) => {
    const rank = (s: string) => {
      const t = s.toLowerCase();
      if (t.includes("google workspace") || t.includes("googleworkspace")) {
        return 0;
      }
      if (isOptionalLaterDemoBlocker(s)) return 2;
      return 1;
    };
    return rank(a) - rank(b);
  });
}

export function demoBlockerConnectionsPath(text: string): string | null {
  const anchor = demoBlockerAnchor(text);
  return anchor ? `/settings/connections${anchor}` : null;
}
