import { listWinLossNotes } from "../leadgen/store";
import { DEFAULT_SALES_OS_SETTINGS, type SalesOsSettings } from "./sops";
import {
  decideEvolveProposal,
  getSalesOsSettings,
  insertEvolveProposal,
  listCompanyResearch,
  mutateSalesOsSettings,
} from "./store";

export async function proposeEvolve(focus = "weekly"): Promise<{
  id: string;
  summary: string;
  proposed: Partial<SalesOsSettings>;
}> {
  const [settings, researched, wins] = await Promise.all([
    getSalesOsSettings(),
    listCompanyResearch(),
    listWinLossNotes(),
  ]);
  const approved = researched.filter(
    (r) => r.approvalState === "approved",
  ).length;
  const approvalRate = researched.length ? approved / researched.length : 0;
  const proposed: Partial<SalesOsSettings> = {};
  const notes: string[] = [];
  if (approvalRate < 0.4 && researched.length >= 3) {
    proposed.caps = {
      ...settings.caps,
      companiesPerResearchRun: Math.max(
        3,
        settings.caps.companiesPerResearchRun - 1,
      ),
    };
    notes.push(
      `Approval rate ${Math.round(approvalRate * 100)}% — tighten daily research volume.`,
    );
  }
  const lostUnsub = wins.filter((w) => /unsub/i.test(w.note)).length;
  if (lostUnsub > 0) {
    proposed.caps = {
      ...(proposed.caps ?? settings.caps),
      emailPerDay: Math.max(8, settings.caps.emailPerDay - 2),
    };
    notes.push("Unsubscribe notes present — lower daily email cap.");
  }
  if (notes.length === 0) {
    notes.push("No SOP change recommended. Keep current ICP and caps.");
  }
  const summary = notes.join(" ");
  const row = await insertEvolveProposal({
    focus,
    summary,
    proposed: proposed as Record<string, unknown>,
  });
  return { id: row.id, summary, proposed };
}

export async function applyEvolve(id: string, actorId?: string | null) {
  const { listEvolveProposals } = await import("./store");
  const row = (await listEvolveProposals()).find((p) => p.id === id);
  if (!row) throw new Error("Proposal not found");
  if (row.state !== "proposed")
    throw new Error(`Proposal already ${row.state}`);
  const next = await mutateSalesOsSettings((current) => {
    const settings = {
      ...current,
      ...row.proposed,
      campaigns: current.campaigns,
      caps: {
        ...current.caps,
        ...((row.proposed.caps as SalesOsSettings["caps"] | undefined) ?? {}),
      },
      icp: {
        ...current.icp,
        ...((row.proposed.icp as SalesOsSettings["icp"] | undefined) ?? {}),
      },
    };
    return { settings, result: settings };
  }, actorId);
  await decideEvolveProposal(id, "applied");
  return next;
}

export async function rejectEvolve(id: string) {
  return decideEvolveProposal(id, "rejected");
}

export function settingsDiffFromDefault(settings: SalesOsSettings) {
  return JSON.stringify(settings) !== JSON.stringify(DEFAULT_SALES_OS_SETTINGS);
}
