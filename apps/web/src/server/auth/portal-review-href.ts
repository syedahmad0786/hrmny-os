/** Staff review links never mint a client identity or send an email. */
export async function portalReviewHref(
  clientId: string,
  options?: {
    next?: string | null;
    emailer?: import("@hrmny/integrations").EmailSendAdapter;
  },
): Promise<string> {
  const id = clientId.trim();
  if (!id) return "/clients";
  if (options?.next === "/portal/onboarding") {
    return `/clients/${encodeURIComponent(id)}#onboarding`;
  }
  return `/client-preview?client=${encodeURIComponent(id)}#approvals`;
}
