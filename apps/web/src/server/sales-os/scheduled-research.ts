import { z } from "zod";
import { searchApolloPeopleFree } from "./apollo-search";
import { ingestManualResearch } from "./research";
import { getSalesOsSettings } from "./store";
import { sectorForDate } from "./sops";

/** Reuses zero-credit discovery and the reviewed proposal inbox; never imports CRM leads or sends email. */
export async function proposeDailyResearch(actorEmployeeId: string, now: Date) {
  z.string().uuid().parse(actorEmployeeId);
  const settings = await getSalesOsSettings();
  const day = now.toISOString().slice(0, 10);
  const sector = sectorForDate(settings, now);
  const search = await searchApolloPeopleFree({
    idempotencyKey: `daily-research:${actorEmployeeId}:${day}`,
    actorEmployeeId,
    query: sector,
    titles: settings.stakeholderTitles.slice(0, 5),
    organizationLocations: ["United Arab Emirates"],
    perPage: Math.max(
      1,
      Math.min(25, settings.caps.companiesPerResearchRun * 3),
    ),
  });
  if (search.mode !== "live")
    throw new Error("Scheduled research requires a live discovery receipt.");
  if (search.status === "processing" || search.status === "retry_scheduled")
    return { pending: true, proposed: 0, receiptId: search.receiptId };
  if (search.status !== "completed")
    throw new Error(
      search.reason ??
        "Discovery failed. Reconnect Apollo or review the failed search.",
    );
  const seen = new Set<string>();
  let proposed = 0;
  let rejected = 0;
  for (const candidate of search.candidates) {
    const name = candidate.companyName?.trim();
    if (!name || !candidate.companyDomain || seen.has(name.toLowerCase()))
      continue;
    if (
      seen.size >=
      Math.max(1, Math.min(10, settings.caps.companiesPerResearchRun))
    )
      break;
    seen.add(name.toLowerCase());
    try {
      const website = new URL(
        `https://${candidate.companyDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`,
      ).origin;
      await ingestManualResearch({
        requestId: `daily-research:${actorEmployeeId}:${day}:${candidate.externalId}`,
        actorEmployeeId,
        name,
        website,
        evidence: website,
        sector,
        market: "UAE",
        whyThis: `Apollo returned ${candidate.title || "a potential decision-maker"} at ${name} for the ${sector} search. Review the company website and service fit; industry, budget and buying intent have not been verified. Discovery receipt: ${search.receiptId}.`,
        leadSourceLane: "industry_scanning",
      });
      proposed++;
    } catch {
      rejected++;
    }
  }
  if (seen.size && !proposed)
    throw new Error(
      "No candidate met the research evidence checks. Review the discovery results.",
    );
  return { pending: false, proposed, rejected, receiptId: search.receiptId };
}
