/**
 * Morning-digest assembly for the M8 daily pipeline. Pure — takes the scored
 * leads and returns a ranked summary; delivery is the injected `digestSink`
 * (Slack/Chat/email at wiring time). No side effects here.
 */

export type ScoredLead = {
  externalId: string;
  fullName: string | null;
  email: string | null;
  companyName: string | null;
  emailVerified: boolean;
  verdict: string;
  buafScore: number;
  temperature: string;
  contactId: string | null;
  dealId: string | null;
};

export type MorningDigest = {
  /** ISO date (YYYY-MM-DD) the digest covers. */
  date: string;
  count: number;
  verifiedCount: number;
  hotCount: number;
  /** Leads ranked by BUAF score, highest first. */
  leads: ScoredLead[];
};

export function buildDigest(
  scoredLeads: ScoredLead[],
  date = new Date().toISOString().slice(0, 10),
): MorningDigest {
  const leads = [...scoredLeads].sort((a, b) => b.buafScore - a.buafScore);
  return {
    date,
    count: leads.length,
    verifiedCount: leads.filter((l) => l.emailVerified).length,
    hotCount: leads.filter((l) => l.temperature === "hot").length,
    leads,
  };
}
