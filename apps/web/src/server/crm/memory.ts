import { randomUUID } from "node:crypto";
import type {
  ActivityRow,
  CompanyRow,
  ContactRow,
  CrmNoteRow,
  CrmQuoteRow,
  CrmTaskRow,
  DealRow,
} from "./types";

const now = () => new Date().toISOString();

const EMP_AM = "c0000000-0000-4000-8000-000000000002";
const EMP_PARTNER = "c0000000-0000-4000-8000-000000000001";

function seedCompanies(): Map<string, CompanyRow> {
  const t = now();
  const rows: CompanyRow[] = [
    {
      companyId: "11000000-0000-4000-8000-000000000001",
      name: "JW Marriott Marquis Dubai",
      sector: "Hospitality",
      market: "UAE",
      website: "https://www.marriott.com",
      linkedinUrl: null,
      notes: "Key hospitality account — brand film pipeline",
      createdAt: t,
      updatedAt: t,
    },
    {
      companyId: "11000000-0000-4000-8000-000000000002",
      name: "Emaar Hospitality Group",
      sector: "Real Estate / Hospitality",
      market: "UAE",
      website: "https://www.emaar.com",
      linkedinUrl: null,
      notes: "Relationship-led intro via partner network",
      createdAt: t,
      updatedAt: t,
    },
    {
      companyId: "11000000-0000-4000-8000-000000000003",
      name: "Al Baik Expansion Co",
      sector: "F&B",
      market: "KSA",
      website: null,
      linkedinUrl: null,
      notes: "Apollo intent signal — KSA market",
      createdAt: t,
      updatedAt: t,
    },
    {
      companyId: "11000000-0000-4000-8000-000000000004",
      name: "Tejari Procurement Desk",
      sector: "Public / Procurement",
      market: "UAE",
      website: null,
      linkedinUrl: null,
      notes: "Tejari RFP lane stub",
      createdAt: t,
      updatedAt: t,
    },
    {
      companyId: "11000000-0000-4000-8000-0000000000b4",
      name: "Other Co FZ-LLC",
      sector: "Services",
      market: "UAE",
      website: null,
      linkedinUrl: null,
      notes:
        "Sandbox isolation client B — must not leak into Demo Co CRM tools",
      createdAt: t,
      updatedAt: t,
    },
  ];
  return new Map(rows.map((r) => [r.companyId, r]));
}

function seedContacts(): Map<string, ContactRow> {
  const t = now();
  const rows: ContactRow[] = [
    {
      contactId: "12000000-0000-4000-8000-000000000001",
      companyId: "11000000-0000-4000-8000-000000000001",
      firstName: "Layla",
      lastName: "Hassan",
      email: "layla.hassan@example-jwmm.ae",
      phone: null,
      title: "Brand Manager",
      linkedinUrl: null,
      emailVerified: true,
      isPrimary: true,
      createdAt: t,
      updatedAt: t,
    },
    {
      contactId: "12000000-0000-4000-8000-000000000002",
      companyId: "11000000-0000-4000-8000-000000000002",
      firstName: "Omar",
      lastName: "Al Falasi",
      email: "omar.alfalasi@example-emaar.ae",
      phone: null,
      title: "Marketing Director",
      linkedinUrl: null,
      emailVerified: false,
      isPrimary: true,
      createdAt: t,
      updatedAt: t,
    },
    {
      contactId: "12000000-0000-4000-8000-000000000003",
      companyId: "11000000-0000-4000-8000-000000000003",
      firstName: "Noura",
      lastName: "Al Qahtani",
      email: "noura@example-albaik.sa",
      phone: null,
      title: "Growth Lead",
      linkedinUrl: null,
      emailVerified: false,
      isPrimary: true,
      createdAt: t,
      updatedAt: t,
    },
    {
      contactId: "12000000-0000-4000-8000-000000000004",
      companyId: "11000000-0000-4000-8000-000000000004",
      firstName: "Procurement",
      lastName: "Inbox",
      email: "rfp@example-tejari.ae",
      phone: null,
      title: "RFP Desk",
      linkedinUrl: null,
      emailVerified: false,
      isPrimary: true,
      createdAt: t,
      updatedAt: t,
    },
    {
      contactId: "12000000-0000-4000-8000-0000000000b4",
      companyId: "11000000-0000-4000-8000-0000000000b4",
      firstName: "Ops",
      lastName: "Lead",
      email: "ops@otherco.example",
      phone: null,
      title: "Operations Lead",
      linkedinUrl: null,
      emailVerified: true,
      isPrimary: true,
      createdAt: t,
      updatedAt: t,
    },
  ];
  return new Map(rows.map((r) => [r.contactId, r]));
}

function seedDeals(): Map<string, DealRow> {
  const t = now();
  const rows: DealRow[] = [
    {
      dealId: "e0000000-0000-4000-8000-000000000001",
      companyId: "11000000-0000-4000-8000-000000000001",
      primaryContactId: "12000000-0000-4000-8000-000000000001",
      companyName: "JW Marriott Marquis Dubai",
      sector: "Hospitality",
      stage: "discover",
      closeOutcome: null,
      lostReason: null,
      leadSourceLane: "relationship_led",
      buafBudget: null,
      buafUrgency: null,
      buafAccess: null,
      buafFit: null,
      buafTemperature: null,
      emailVerified: false,
      quoteValue: "50000.00",
      internalCost: "30000.00",
      marginPct: "40.00",
      discountPct: null,
      discountApprovalTier: null,
      vendorHandlingFeePct: "20.00",
      ownerEmployeeId: EMP_AM,
      createdAt: t,
      updatedAt: t,
    },
    {
      dealId: "e0000000-0000-4000-8000-000000000002",
      companyId: "11000000-0000-4000-8000-000000000002",
      primaryContactId: "12000000-0000-4000-8000-000000000002",
      companyName: "Emaar Hospitality Group",
      sector: "Real Estate / Hospitality",
      stage: "engage",
      closeOutcome: null,
      lostReason: null,
      leadSourceLane: "relationship_led",
      buafBudget: true,
      buafUrgency: true,
      buafAccess: true,
      buafFit: true,
      buafTemperature: "hot",
      emailVerified: false,
      quoteValue: "120000.00",
      internalCost: "72000.00",
      marginPct: "40.00",
      discountPct: null,
      discountApprovalTier: null,
      vendorHandlingFeePct: "20.00",
      ownerEmployeeId: EMP_AM,
      createdAt: t,
      updatedAt: t,
    },
    {
      dealId: "e0000000-0000-4000-8000-000000000003",
      companyId: "11000000-0000-4000-8000-000000000003",
      primaryContactId: "12000000-0000-4000-8000-000000000003",
      companyName: "Al Baik Expansion Co",
      sector: "F&B",
      stage: "qualify",
      closeOutcome: null,
      lostReason: null,
      leadSourceLane: "apollo_intent",
      buafBudget: true,
      buafUrgency: false,
      buafAccess: true,
      buafFit: true,
      buafTemperature: "warm",
      emailVerified: false,
      quoteValue: "45000.00",
      internalCost: "28000.00",
      marginPct: "37.78",
      discountPct: null,
      discountApprovalTier: null,
      vendorHandlingFeePct: "20.00",
      ownerEmployeeId: EMP_AM,
      createdAt: t,
      updatedAt: t,
    },
    {
      dealId: "e0000000-0000-4000-8000-000000000004",
      companyId: "11000000-0000-4000-8000-000000000004",
      primaryContactId: "12000000-0000-4000-8000-000000000004",
      companyName: "Tejari Procurement Desk",
      sector: "Public / Procurement",
      stage: "discover",
      closeOutcome: null,
      lostReason: null,
      leadSourceLane: "tejari",
      buafBudget: false,
      buafUrgency: false,
      buafAccess: false,
      buafFit: false,
      buafTemperature: null,
      emailVerified: false,
      quoteValue: "0.00",
      internalCost: "0.00",
      marginPct: "0.00",
      discountPct: null,
      discountApprovalTier: null,
      vendorHandlingFeePct: "20.00",
      ownerEmployeeId: EMP_PARTNER,
      createdAt: t,
      updatedAt: t,
    },
    {
      dealId: "e0000000-0000-4000-8000-000000000005",
      companyId: "11000000-0000-4000-8000-000000000001",
      primaryContactId: "12000000-0000-4000-8000-000000000001",
      companyName: "JW Marriott Marquis Dubai",
      sector: "Hospitality",
      stage: "propose",
      closeOutcome: null,
      lostReason: null,
      leadSourceLane: "relationship_led",
      buafBudget: true,
      buafUrgency: true,
      buafAccess: true,
      buafFit: true,
      buafTemperature: "hot",
      emailVerified: true,
      quoteValue: "85000.00",
      internalCost: "48000.00",
      marginPct: "43.53",
      discountPct: null,
      discountApprovalTier: null,
      vendorHandlingFeePct: "20.00",
      ownerEmployeeId: EMP_AM,
      createdAt: t,
      updatedAt: t,
    },
    {
      dealId: "e0000000-0000-4000-8000-0000000000b4",
      companyId: "11000000-0000-4000-8000-0000000000b4",
      primaryContactId: "12000000-0000-4000-8000-0000000000b4",
      companyName: "Other Co FZ-LLC",
      sector: "Services",
      stage: "won",
      closeOutcome: "won",
      lostReason: null,
      leadSourceLane: "relationship_led",
      buafBudget: true,
      buafUrgency: true,
      buafAccess: true,
      buafFit: true,
      buafTemperature: "hot",
      emailVerified: true,
      quoteValue: "12000.00",
      internalCost: "7200.00",
      marginPct: "40.00",
      discountPct: null,
      discountApprovalTier: null,
      vendorHandlingFeePct: "20.00",
      ownerEmployeeId: EMP_AM,
      createdAt: t,
      updatedAt: t,
    },
  ];
  return new Map(rows.map((r) => [r.dealId, r]));
}

export type CrmMemory = {
  companies: Map<string, CompanyRow>;
  contacts: Map<string, ContactRow>;
  deals: Map<string, DealRow>;
  activities: Map<string, ActivityRow>;
  notes: Map<string, CrmNoteRow>;
  tasks: Map<string, CrmTaskRow>;
  quotes: Map<string, CrmQuoteRow>;
};

let memory: CrmMemory | null = null;

export function getCrmMemory(): CrmMemory {
  if (memory) return memory;
  const t = now();
  memory = {
    companies: seedCompanies(),
    contacts: seedContacts(),
    deals: seedDeals(),
    activities: new Map([
      [
        "13000000-0000-4000-8000-000000000001",
        {
          activityId: "13000000-0000-4000-8000-000000000001",
          type: "call",
          subject: "Discovery call — JWMM brand film",
          body: "Discussed enhancement program film scope and timeline.",
          companyId: "11000000-0000-4000-8000-000000000001",
          contactId: "12000000-0000-4000-8000-000000000001",
          dealId: "e0000000-0000-4000-8000-000000000001",
          actorEmployeeId: EMP_AM,
          occurredAt: new Date(Date.now() - 3 * 864e5).toISOString(),
          metadata: {},
          createdAt: t,
          updatedAt: t,
        },
      ],
      [
        "13000000-0000-4000-8000-000000000002",
        {
          activityId: "13000000-0000-4000-8000-000000000002",
          type: "email",
          subject: "Intro email — Emaar",
          body: "Warm intro sent; waiting on brand guidelines.",
          companyId: "11000000-0000-4000-8000-000000000002",
          contactId: "12000000-0000-4000-8000-000000000002",
          dealId: "e0000000-0000-4000-8000-000000000002",
          actorEmployeeId: EMP_AM,
          occurredAt: new Date(Date.now() - 864e5).toISOString(),
          metadata: {},
          createdAt: t,
          updatedAt: t,
        },
      ],
      [
        "13000000-0000-4000-8000-000000000005",
        {
          activityId: "13000000-0000-4000-8000-000000000005",
          type: "system",
          subject: "Synthetic signed agreement recorded for quote v1",
          body: null,
          companyId: "11000000-0000-4000-8000-000000000001",
          contactId: "12000000-0000-4000-8000-000000000001",
          dealId: "e0000000-0000-4000-8000-000000000005",
          actorEmployeeId: EMP_PARTNER,
          occurredAt: t,
          metadata: {
            quoteId: "16000000-0000-4000-8000-000000000001",
            quoteVersion: 1,
            evidenceUrl: "https://fixtures.hrmny.co/signed-agreement",
            synthetic: true,
          },
          createdAt: t,
          updatedAt: t,
        },
      ],
    ]),
    notes: new Map([
      [
        "14000000-0000-4000-8000-000000000001",
        {
          crmNoteId: "14000000-0000-4000-8000-000000000001",
          body: "Client prefers Arabic subtitles on social cutdowns; confirm in scope.",
          companyId: "11000000-0000-4000-8000-000000000001",
          contactId: null,
          dealId: "e0000000-0000-4000-8000-000000000005",
          authorEmployeeId: EMP_AM,
          createdAt: t,
          updatedAt: t,
        },
      ],
    ]),
    tasks: new Map([
      [
        "15000000-0000-4000-8000-000000000001",
        {
          crmTaskId: "15000000-0000-4000-8000-000000000001",
          title: "Send revised JWMM proposal deck",
          status: "open",
          dueDate: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10),
          companyId: "11000000-0000-4000-8000-000000000001",
          contactId: null,
          dealId: "e0000000-0000-4000-8000-000000000005",
          ownerEmployeeId: EMP_AM,
          createdAt: t,
          updatedAt: t,
        },
      ],
      [
        "15000000-0000-4000-8000-000000000002",
        {
          crmTaskId: "15000000-0000-4000-8000-000000000002",
          title: "Book discovery with Omar (Emaar)",
          status: "in_progress",
          dueDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
          companyId: "11000000-0000-4000-8000-000000000002",
          contactId: null,
          dealId: "e0000000-0000-4000-8000-000000000002",
          ownerEmployeeId: EMP_AM,
          createdAt: t,
          updatedAt: t,
        },
      ],
    ]),
    quotes: new Map([
      [
        "16000000-0000-4000-8000-000000000001",
        {
          quoteId: "16000000-0000-4000-8000-000000000001",
          dealId: "e0000000-0000-4000-8000-000000000005",
          version: 1,
          lineItems: [
            {
              label: "Synthetic JWMM retainer",
              unitSell: 85_000,
              unitCost: 48_000,
              qty: 1,
            },
          ],
          quoteValue: "85000.00",
          internalCost: "48000.00",
          marginPct: "43.53",
          discountPct: null,
          discountApprovalTier: null,
          status: "accepted",
          createdBy: EMP_PARTNER,
          createdAt: t,
          updatedAt: t,
        },
      ],
    ]),
  };
  return memory;
}

export function resetCrmMemory() {
  memory = null;
  return getCrmMemory();
}

export function newId() {
  return randomUUID();
}
