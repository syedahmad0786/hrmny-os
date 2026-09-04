export const CRM_MARKETS = [
  "UAE",
  "KSA",
  "Oman",
  "Qatar",
  "Kuwait",
  "Bahrain",
  "GCC",
  "Both",
] as const;

export type CrmMarket = (typeof CRM_MARKETS)[number];
