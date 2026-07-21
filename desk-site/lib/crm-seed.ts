export type DeskDeal = {
  id: string;
  stage: string;
  name: string;
  company: string;
  companyId: string;
  value: number;
  temp: "hot" | "warm" | "cool" | "cold" | null;
  lane: string;
  owner: string;
  buaf: number;
  emailVerified: boolean;
  updatedAt: string;
};

export type DeskCompany = {
  id: string;
  name: string;
  sector: string;
  market: string;
  website: string | null;
  notes: string | null;
};

export type DeskContact = {
  id: string;
  companyId: string;
  name: string;
  title: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  isPrimary: boolean;
};

export type DeskActivity = {
  id: string;
  type: string;
  subject: string;
  body: string;
  dealId: string | null;
  companyId: string | null;
  occurredAt: string;
};

export type DeskTask = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  dueDate: string | null;
  companyId: string | null;
};

export const STAGES = [
  { key: "discover", label: "Discover" },
  { key: "qualify", label: "Qualify" },
  { key: "engage", label: "Engage" },
  { key: "scope", label: "Scope" },
  { key: "propose", label: "Propose" },
  { key: "price_cost", label: "Price / Cost" },
  { key: "close", label: "Close" },
  { key: "handover_pack", label: "Handover Pack" },
] as const;

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 864e5).toISOString();
const daysAhead = (n: number) =>
  new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** Seed mirrors apps/web CRM memory — used until desk is wired to monorepo APIs. */
export function createCrmSeed() {
  const companies: DeskCompany[] = [
    {
      id: "c1",
      name: "JW Marriott Marquis Dubai",
      sector: "Hospitality",
      market: "UAE",
      website: "https://www.marriott.com",
      notes: "Key hospitality account — brand film pipeline",
    },
    {
      id: "c2",
      name: "Emaar Hospitality Group",
      sector: "Real Estate / Hospitality",
      market: "UAE",
      website: "https://www.emaar.com",
      notes: "Relationship-led intro via partner network",
    },
    {
      id: "c3",
      name: "Al Baik Expansion Co",
      sector: "F&B",
      market: "KSA",
      website: null,
      notes: "Apollo intent signal — KSA market",
    },
    {
      id: "c4",
      name: "Tejari Procurement Desk",
      sector: "Public / Procurement",
      market: "UAE",
      website: null,
      notes: "Tejari RFP lane",
    },
  ];

  const contacts: DeskContact[] = [
    {
      id: "p1",
      companyId: "c1",
      name: "Layla Hassan",
      title: "Brand Manager",
      email: "layla.hassan@example-jwmm.ae",
      phone: null,
      emailVerified: true,
      isPrimary: true,
    },
    {
      id: "p2",
      companyId: "c2",
      name: "Omar Al Falasi",
      title: "Marketing Director",
      email: "omar.alfalasi@example-emaar.ae",
      phone: null,
      emailVerified: false,
      isPrimary: true,
    },
    {
      id: "p3",
      companyId: "c3",
      name: "Noura Al Qahtani",
      title: "Growth Lead",
      email: "noura@example-albaik.sa",
      phone: null,
      emailVerified: false,
      isPrimary: true,
    },
    {
      id: "p4",
      companyId: "c4",
      name: "Procurement Inbox",
      title: "RFP Desk",
      email: "rfp@example-tejari.ae",
      phone: null,
      emailVerified: false,
      isPrimary: true,
    },
  ];

  const deals: DeskDeal[] = [
    {
      id: "d1",
      stage: "discover",
      name: "Brand film",
      company: "JW Marriott Marquis Dubai",
      companyId: "c1",
      value: 50000,
      temp: null,
      lane: "relationship_led",
      owner: "AM",
      buaf: 0,
      emailVerified: false,
      updatedAt: daysAgo(1),
    },
    {
      id: "d2",
      stage: "engage",
      name: "Hospitality platform",
      company: "Emaar Hospitality Group",
      companyId: "c2",
      value: 120000,
      temp: "hot",
      lane: "relationship_led",
      owner: "AM",
      buaf: 4,
      emailVerified: false,
      updatedAt: daysAgo(0),
    },
    {
      id: "d3",
      stage: "qualify",
      name: "KSA market entry",
      company: "Al Baik Expansion Co",
      companyId: "c3",
      value: 45000,
      temp: "warm",
      lane: "apollo_intent",
      owner: "AM",
      buaf: 3,
      emailVerified: false,
      updatedAt: daysAgo(2),
    },
    {
      id: "d4",
      stage: "discover",
      name: "RFP response",
      company: "Tejari Procurement Desk",
      companyId: "c4",
      value: 0,
      temp: null,
      lane: "tejari",
      owner: "PT",
      buaf: 0,
      emailVerified: false,
      updatedAt: daysAgo(3),
    },
    {
      id: "d5",
      stage: "propose",
      name: "Enhancement film",
      company: "JW Marriott Marquis Dubai",
      companyId: "c1",
      value: 85000,
      temp: "hot",
      lane: "relationship_led",
      owner: "AM",
      buaf: 4,
      emailVerified: true,
      updatedAt: daysAgo(0),
    },
  ];

  const activities: DeskActivity[] = [
    {
      id: "a1",
      type: "call",
      subject: "Discovery call — JWMM brand film",
      body: "Discussed enhancement program film scope and timeline.",
      dealId: "d1",
      companyId: "c1",
      occurredAt: daysAgo(3),
    },
    {
      id: "a2",
      type: "email",
      subject: "Intro email — Emaar",
      body: "Warm intro sent; waiting on brand guidelines.",
      dealId: "d2",
      companyId: "c2",
      occurredAt: daysAgo(1),
    },
    {
      id: "a3",
      type: "stage_change",
      subject: "Stage changed · JWMM enhancement",
      body: "Moved into Propose after BUAF complete.",
      dealId: "d5",
      companyId: "c1",
      occurredAt: daysAgo(0),
    },
  ];

  const tasks: DeskTask[] = [
    {
      id: "t1",
      title: "Send revised JWMM proposal deck",
      status: "open",
      dueDate: daysAhead(2),
      companyId: "c1",
    },
    {
      id: "t2",
      title: "Book discovery with Omar (Emaar)",
      status: "in_progress",
      dueDate: daysAhead(5),
      companyId: "c2",
    },
  ];

  return { companies, contacts, deals, activities, tasks };
}

export function formatAed(n: number) {
  if (!n) return "—";
  return `AED ${n.toLocaleString("en-AE", { maximumFractionDigits: 0 })}`;
}

export function formatLane(lane: string) {
  return lane.replace(/_/g, " ");
}

export function formatRelative(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export function initials(name: string) {
  const p = name.trim().split(/\s+/);
  if (p.length === 1) return p[0]!.slice(0, 2).toUpperCase();
  return `${p[0]![0] ?? ""}${p[1]![0] ?? ""}`.toUpperCase();
}
