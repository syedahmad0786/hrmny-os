/**
 * Sales & Growth SOPs extracted from the official hrmny Sales & Growth
 * documentation (v3.0, 2026-02-27, written for Ayham Homsi) and the June
 * SQLite prototype encoded in `@hrmny/integrations/salesgrowth`.
 *
 * The Windows Claude project and Drive zip were not mounted here; these
 * defaults are the seed that replaces `reference/*.md` + `context/strategy.md`
 * inside the CRM. Staff edit them from /crm/settings/sales-os. /evolve
 * proposes diffs; a human applies them.
 */

export type SalesOsSettings = {
  campaigns: SalesCampaignDefinition[];
  rateCard: Array<{
    service: string;
    unit: string;
    unitSell: number;
    unitCost: number;
    active: boolean;
  }>;
  icp: {
    target: string;
    primarySectors: string[];
    secondarySectors: string[];
    noGo: string[];
    minEmployeesGlobal: number;
    minEmployeesMena: number;
    minSeniority: string;
  };
  sectorRotation: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
  searchTemplates: Record<string, string[]>;
  stakeholderTitles: string[];
  outreach: {
    voice: string;
    emailWordsMin: number;
    emailWordsMax: number;
    linkedinConnectMaxChars: number;
    linkedinFollowupWords: number;
    cadenceTouches: number;
    cadenceDays: number;
    specificityTest: boolean;
    senderName: string;
    senderTitle: string;
    physicalAddress: string;
    unsubscribePath: string;
    senderMailboxes: Array<{
      connectionAccountId: string;
      label: string;
      dailyCap: number;
      enabled: boolean;
    }>;
  };
  buaf: {
    hotMin: number;
    warmMin: number;
    coolMin: number;
    /** 1–10 per dimension, max 40. */
    maxScore: number;
  };
  caps: {
    apolloContactsPerMonth: number;
    emailPerDay: number;
    linkedinConnectsPerWeek: number;
    companiesPerResearchRun: number;
    pauseAllOutreach: boolean;
  };
  targets: {
    h1BookedAed: number;
    pipelineCoverageX: number;
    weeklyCompaniesMin: number;
    weeklyCompaniesMax: number;
    weeklyContactsMin: number;
    weeklyContactsMax: number;
    weeklyMeetingsMin: number;
    weeklyMeetingsMax: number;
  };
  stallDays: Record<string, number>;
  retentionMonths: number;
};

export type SalesCampaignDefinition = {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed";
  dealIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  receipts: Array<{
    receiptId: string;
    kind: "first_touch" | "followup";
    createdAt: string;
    summary: string;
  }>;
};

export const SALES_OS_SOP_SOURCE = {
  title: "hrmny Sales & Growth System — Complete Documentation",
  version: "3.0",
  date: "2026-02-27",
  author: "Ahmad Bukhari",
  for: "Ayham Homsi, Managing Partner, hrmny",
  driveId: "1nn_zPF5srzhoVqVmhNE7VeAETs4UQzgDJq4WmJAiG8Y",
} as const;

export const DEFAULT_SALES_OS_SETTINGS: SalesOsSettings = {
  campaigns: [],
  rateCard: [
    {
      service: "Social media retainer",
      unit: "month",
      unitSell: 0,
      unitCost: 0,
      active: true,
    },
    {
      service: "Strategic communications retainer",
      unit: "month",
      unitSell: 0,
      unitCost: 0,
      active: true,
    },
    {
      service: "Brand experience campaign",
      unit: "project",
      unitSell: 0,
      unitCost: 0,
      active: true,
    },
    {
      service: "Content production",
      unit: "project",
      unitSell: 0,
      unitCost: 0,
      active: true,
    },
    {
      service: "Music services",
      unit: "project",
      unitSell: 0,
      unitCost: 0,
      active: true,
    },
  ],
  icp: {
    target:
      "Global brands in the UAE + strong local brands with real marketing budgets",
    primarySectors: [
      "Retail + Consumer Experience",
      "Sports / Wellness / Movements",
    ],
    secondarySectors: ["Automotive (incl. EV entrants)"],
    noGo: [
      "Alcohol",
      "Tobacco",
      "Low-budget startups",
      "Small local brands",
      "Crypto / Web3",
      "Political",
      "Spec-work",
      "Gambling",
      "Adult",
      "Unlicensed finance",
    ],
    minEmployeesGlobal: 50,
    minEmployeesMena: 15,
    minSeniority: "Director or above (VP+ for enterprise)",
  },
  sectorRotation: {
    monday: "retail",
    tuesday: "sports",
    wednesday: "automotive",
    thursday: "retail",
    friday: "signals",
    saturday: "signals",
    sunday: "review",
  },
  searchTemplates: {
    retail: [
      "retail brand opening flagship Dubai OR UAE 2026",
      "fashion beauty consumer brand launching in Dubai Mall",
      "global retail brand hiring Head of Marketing MENA",
    ],
    sports: [
      "sports wellness brand entering UAE OR GCC",
      "fitness movement brand campaign Dubai",
      "sportswear brand hiring marketing director Middle East",
    ],
    automotive: [
      "EV brand entering GCC market",
      "automotive brand UAE launch campaign",
      "car brand hiring Head of Marketing MENA",
    ],
    signals: [
      "UAE brand Ramadan campaign planning",
      "company opening Dubai office hiring marketing",
      "enterprise brand RFP creative agency UAE",
    ],
  },
  stakeholderTitles: [
    "CMO",
    "VP Marketing",
    "Head of Marketing",
    "Brand Director",
    "Head of Marketing MENA",
    "Marketing Director",
  ],
  outreach: {
    voice:
      "Managing Partner, relationship-first, specific, never a template. Agency reputation, not product blast.",
    emailWordsMin: 150,
    emailWordsMax: 200,
    linkedinConnectMaxChars: 300,
    linkedinFollowupWords: 100,
    cadenceTouches: 6,
    cadenceDays: 18,
    specificityTest: true,
    senderName: "Ayham Homsi",
    senderTitle: "Managing Partner, hrmny",
    physicalAddress: "hrmny, Dubai, United Arab Emirates",
    unsubscribePath: "/api/sales-os/unsubscribe",
    senderMailboxes: [],
  },
  buaf: {
    hotMin: 33,
    warmMin: 25,
    coolMin: 17,
    maxScore: 40,
  },
  caps: {
    apolloContactsPerMonth: 160,
    emailPerDay: 15,
    linkedinConnectsPerWeek: 20,
    companiesPerResearchRun: 5,
    pauseAllOutreach: false,
  },
  targets: {
    h1BookedAed: 5_000_000,
    pipelineCoverageX: 3,
    weeklyCompaniesMin: 12,
    weeklyCompaniesMax: 18,
    weeklyContactsMin: 10,
    weeklyContactsMax: 20,
    weeklyMeetingsMin: 2,
    weeklyMeetingsMax: 3,
  },
  stallDays: {
    discover: 7,
    qualify: 10,
    engage: 14,
    scope: 14,
    propose: 21,
    price_cost: 14,
    close: 21,
    handover_pack: 7,
  },
  retentionMonths: 24,
};

export const OUTREACH_GUIDELINES = `
# Outreach guidelines (Sales & Growth SOP)

Voice: Managing Partner. Relationship-first. Reputation-driven. Service, not product.

Cold email (150–200 words):
1. Specific opening observation about THIS company (launch, hire, location, campaign).
2. Bridge to a concrete opportunity hrmny can help with.
3. One credibility signal (relevant work, not a capability dump).
4. Direct CTA (15-minute call). No tracking pixels.

LinkedIn connection (max 300 characters):
Personalised, non-salesy introduction. No pitch. No calendar link.

LinkedIn follow-up (~100 words):
Value-forward. Meeting CTA. Only after the human marks the connection Accepted.

Specificity test: if you can swap another company name and the copy still reads
naturally, rewrite it.

If the contact has no verified email, skip email and use LinkedIn-only cadence.

Never auto-send. Gate 3 is per channel. Approve ≠ send.
`.trim();

export const RESEARCH_GUIDELINES = `
# Daily research SOP

Sector rotation (Asia/Dubai):
- Monday / Thursday: Retail + Consumer Experience
- Tuesday: Sports / Wellness / Movements
- Wednesday: Automotive (incl. EV)
- Friday: Signal-driven (news, launches, hiring, RFPs)
- Sunday: pipeline review, no new hunt unless override

Per run: 3–5 companies. Filter the 10 no-go rules. Score BUAF 1–10 × 4
(Budget, Urgency, Access, Fit) plus sector priority. Deduplicate against
existing CRM companies and prior research.

Hot (33–40): prioritise, 3 Apollo contacts.
Warm (25–32): pursue, 2 Apollo contacts.
Cool (17–24): park, 0 contacts.
Cold (1–16): do not pursue.

Lead source lanes: industry_scanning | apollo_intent | relationship_led | tejari | inbound.
`.trim();

export function weekdayKey(
  date: Date = new Date(),
): keyof SalesOsSettings["sectorRotation"] {
  return (
    [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ] as const
  )[date.getUTCDay()]!;
}

export function sectorForDate(
  settings: SalesOsSettings,
  date: Date = new Date(),
): string {
  return settings.sectorRotation[weekdayKey(date)];
}

export function temperatureFromScore(
  score: number,
  settings: SalesOsSettings = DEFAULT_SALES_OS_SETTINGS,
): "hot" | "warm" | "cool" | "cold" {
  if (score >= settings.buaf.hotMin) return "hot";
  if (score >= settings.buaf.warmMin) return "warm";
  if (score >= settings.buaf.coolMin) return "cool";
  return "cold";
}

export function contactsForTemperature(
  temperature: "hot" | "warm" | "cool" | "cold",
): number {
  if (temperature === "hot") return 3;
  if (temperature === "warm") return 2;
  return 0;
}
