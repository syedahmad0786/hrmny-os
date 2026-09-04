import { isSyntheticRecordName } from "@/lib/synthetic-records";

export function matchesCampaignLeadView(
  deal: {
    companyName: string;
    sector?: string | null;
    leadSourceLane: string;
  },
  query: string,
  showTestRecords: boolean,
): boolean {
  const search = query.trim().toLowerCase();
  return (
    (showTestRecords || !isSyntheticRecordName(deal.companyName)) &&
    (!search ||
      deal.companyName.toLowerCase().includes(search) ||
      (deal.sector ?? "").toLowerCase().includes(search) ||
      deal.leadSourceLane.toLowerCase().includes(search))
  );
}
