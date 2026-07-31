import { canViewMargin, stripMarginFields } from "@hrmny/db";
import {
  createApolloAdapter,
  createBayzatAdapter,
  createComposioStub,
  createHunterAdapter,
  createMemoryObjectStore,
  createSupabaseObjectStore,
  createXeroAdapter,
  type ApolloAdapter,
  type BayzatAdapter,
  type BayzatEmployeeRow,
  type ComposioSendAdapter,
  type HunterAdapter,
  type ObjectStore,
  type XeroAdapter,
} from "@hrmny/integrations";
import { createProvider, type LLMProvider } from "@hrmny/ai";
import { VENDOR_FEE_DEFAULT_PCT } from "@hrmny/gate";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminConfig } from "./supabase-admin-config";

export type DemoConvention = {
  ruleKey: string;
  version: number;
  payload: Record<string, unknown>;
  updatedAt: string;
  updatedByEmployeeId: string | null;
};

/** DAM_STORAGE=memory (local only) | supabase (required on Vercel). */
export function createObjectStoreFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ObjectStore {
  const mode = (env.DAM_STORAGE ?? "memory").toLowerCase();
  const hosted = ["preview", "production"].includes(
    env.VERCEL_ENV?.toLowerCase() ?? "",
  );
  if (hosted && mode !== "supabase") {
    throw new Error(
      "DAM_STORAGE=supabase is required for preview and production deployments",
    );
  }
  if (mode === "supabase") {
    const config = getSupabaseAdminConfig(env);
    const bucket = env.DAM_BUCKET ?? "hrmny-dam";
    if (!config) {
      throw new Error(
        "DAM_STORAGE=supabase requires NEXT_PUBLIC_SUPABASE_URL and a Supabase server secret key",
      );
    }
    const client = createClient(config.url, config.key);
    return createSupabaseObjectStore(client, bucket);
  }
  if (mode !== "memory")
    throw new Error(`Unsupported DAM_STORAGE mode: ${mode}`);
  return createMemoryObjectStore();
}

export type DemoQuoteLine = {
  label: string;
  unitSell: number;
  unitCost: number;
  qty: number;
  isVendor: boolean;
};

export type DemoDeal = {
  dealId: string;
  companyName: string;
  sector: string | null;
  stage: string;
  closeOutcome: "won" | "lost" | "postponed_on_hold" | null;
  lostReason: string | null;
  leadSourceLane: string;
  buafBudget: boolean;
  buafUrgency: boolean;
  buafAccess: boolean;
  buafFit: boolean;
  buafTemperature: "hot" | "warm" | "cool" | "cold" | null;
  noGoFlags: string[];
  emailVerified: boolean;
  contactEmail: string | null;
  voiceCheckPassed: boolean;
  quoteValue: string;
  internalCost: string;
  marginPct: string;
  discountPct: string;
  discountApprovalTier: "am" | "md" | "partner" | null;
  vendorHandlingFeePct: string;
  quoteLines: DemoQuoteLine[];
  ownerEmployeeId: string | null;
  enrichment: Record<string, unknown> | null;
  commercialMode: "project" | "retainer" | "lean_package";
};

export type DemoAudit = {
  auditEventId: string;
  actorEmployeeId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
};

export type DemoAsset = {
  assetId: string;
  title: string;
  status: string;
  clientId: string | null;
  taskId: string | null;
  workItemId: string | null;
  qcPassed: boolean;
  versions: DemoAssetVersion[];
};

export type DemoAssetVersion = {
  assetVersionId: string;
  assetId: string;
  storagePath: string;
  versionNumber: number;
  isClientRevision: boolean;
  uploadedByEmployeeId: string | null;
  createdAt: string;
};

export type DemoRole = { roleId?: string; key: string; displayName: string };

export type DemoConnection = {
  connectionAccountId: string;
  toolkit: string;
  scope: "staff" | "portal";
  status: string;
  externalConnectionId: string | null;
};

export type HealthSignal = {
  signalKey: string;
  severity: string;
  payload: Record<string, unknown>;
  notifiedAt: string | null;
  deliveryStatus: "not_configured" | "pending" | "delivered" | "failed";
  notificationAttempts: number;
  lastError: string | null;
  createdAt: string;
};

export type DemoInvoiceProposal = {
  proposalId: string;
  emailRef: string;
  status: "pending" | "approved" | "rejected" | "edited";
  payload: Record<string, unknown>;
  invoiceId: string | null;
  createdAt: string;
};

export type DemoInvoice = {
  invoiceId: string;
  status: string;
  contactName: string;
  amount: string;
  vatAmount: string;
  currency: string;
  invoiceType: string;
  /** M5: retainer | progress | first | intake */
  billingKind: "intake" | "retainer" | "progress" | "first";
  clientId: string | null;
  period: string | null;
  trn: string | null;
  trnStatus: "known" | "unknown_held";
  ruleCited: string | null;
  sourceAttached: Record<string, unknown> | null;
  xeroInvoiceId: string | null;
  proposedByEmployeeId: string | null;
  approvedByEmployeeId: string | null;
  createdAt: string;
};

export type DemoPayrollLine = {
  externalId: string;
  displayName: string;
  email: string;
  department: string | null;
  grossAmount: string;
  currency: string;
};

export type DemoVatDoc = {
  docId: string;
  period: string;
  title: string;
  unread: boolean;
};

export type DemoVatReturn = {
  returnId: string;
  quarter: string;
  status: "prepared" | "signed";
  boxImpacts: Record<string, string>;
  preparedByEmployeeId: string | null;
  signedByEmployeeId: string | null;
  createdAt: string;
};

export type DemoClientMarginRow = {
  clientId: string;
  clientName: string;
  fee: string;
  contractValue: string;
  revenueToDate: string;
  deliveryCost: string;
  marginPct: string;
  marginAtSalePct: string | null;
  dealMarginPct: string | null;
  overServicing: boolean;
  scopeVsActualPct: string;
};

export type DemoEmployee = {
  employeeId: string;
  displayName: string;
  email: string;
  lifecycleStatus: string;
  checklist: Record<string, boolean>;
  probationDueAt: string | null;
  escalatedAt: string | null;
  bayzatExternalId: string | null;
  spawnedBundle: boolean;
};

export type DemoRequisition = {
  requisitionId: string;
  title: string;
  department: string;
  status: "draft" | "pending" | "approved" | "rejected";
  requesterEmployeeId: string;
  approverEmployeeId: string | null;
  createdAt: string;
};

export type DemoPayrollRun = {
  payrollRunId: string;
  period: string;
  status: string;
  confirmedByEmployeeId: string | null;
  approvedByEmployeeId: string | null;
  xeroJournalId: string | null;
  lines: DemoPayrollLine[];
  totalGross: string;
  adjustments: Record<string, unknown> | null;
  source: "bayzat_mirror";
  /** Always false — OS never disburses. */
  disbursed: false;
  createdAt: string;
};

/** UAE VAT rate for retainer/progress drafts. */
export const UAE_VAT_RATE = 0.05;

export function vatOnAmount(amountAed: number): string {
  return (amountAed * UAE_VAT_RATE).toFixed(2);
}

export type DemoEscalation = {
  escalationId: string;
  employeeId: string;
  kind: string;
  message: string;
  createdAt: string;
  notified: boolean;
};

export type DemoClient = {
  clientId: string;
  dealId: string;
  name: string;
  market: string;
  engagementType: string;
  contractValue: string;
  currency: string;
  startDate: string;
  renewalDate: string;
  fee: string;
  lifecycleStatus: string;
  contacts: Record<string, unknown>;
  approvers: Record<string, unknown>;
};

export type DemoScope = {
  scopeId: string;
  clientId: string;
  dealId: string | null;
  title: string;
  value: string;
  terms: string | null;
  periodStart: string;
  periodEnd: string | null;
  status: string;
  marginAtSalePct: string | null;
  lines: DemoQuoteLine[];
};

export type DemoImmersion = {
  immersionId: string;
  clientId: string;
  swot: Record<string, unknown> | null;
  usp: string | null;
  audience: string | null;
  socialAccounts: Record<string, unknown> | null;
  competitors: unknown[] | null;
  objectivePriority: string | null;
  brandAssets: Record<string, unknown> | null;
  approvers: Record<string, unknown> | null;
  completedAt: string | null;
};

export type DemoOnboardingStep = {
  stepId: string;
  title: string;
  raci: string;
  done: boolean;
};

export type DemoOnboardingPhase = {
  phaseId: string;
  phaseIndex: number;
  name: string;
  status: "pending" | "active" | "signed_off";
  steps: DemoOnboardingStep[];
  signedOffAt: string | null;
};

export type DemoApprovalItem = {
  approvalId: string;
  dealId: string;
  channel: "gmail" | "linkedin";
  status: "pending" | "approved" | "rejected" | "sent";
  subject: string;
  body: string;
  toEmail: string;
  idempotencyKey: string | null;
  externalId: string | null;
  sendMode: string | null;
  createdAt: string;
  decidedAt: string | null;
  rejectReason: string | null;
};

export type DemoHandoverPack = {
  packId: string;
  dealId: string;
  clientId: string;
  fired: string[];
  createdAt: string;
};

export type DemoCalendar = {
  calendarId: string;
  clientId: string;
  month: string;
  focusPoints: unknown[];
  refApprovalState: string | null;
  finalApprovalState: string | null;
  shootDate: string | null;
  state: string;
  slots: DemoCalendarSlot[];
};

export type DemoCalendarSlot = {
  calendarSlotId: string;
  calendarId: string;
  slotDate: string;
  slotLabel: string | null;
  taskId: string | null;
  position: number;
};

export type DemoTask = {
  taskId: string;
  clientId: string;
  calendarId: string | null;
  month: string | null;
  taskType: string;
  title: string;
  status: string;
  situationalState: string | null;
  ownerEmployeeId: string | null;
  deadline: string | null;
  priority: string | null;
  qcPassed: boolean;
  qcNotes: string | null;
  clientRevisionCount: number;
  revisionBoundaryAck: boolean;
  briefId: string | null;
};

export type DemoBrief = {
  briefId: string;
  taskId: string;
  body: Record<string, unknown>;
  dorComplete: boolean;
  missingRequiredCount: number;
  missing: string[];
  lockedAt: string | null;
};

export type DemoMonth1Phase = {
  phaseIndex: number;
  name: string;
  status: "pending" | "active" | "done";
  gate: string;
};

const DEMO_DEAL_ID = "e0000000-0000-4000-8000-000000000001";
const DEMO_EMPLOYEE_ID = "e1000000-0000-4000-8000-000000000001";
const DEMO_CLIENT_ID = "c1000000-0000-4000-8000-0000000000a4";
/** Second client for portal isolation demos (must not leak into portal_a). */
const DEMO_CLIENT_B_ID = "c1000000-0000-4000-8000-0000000000b4";
const DEMO_CALENDAR_ID = "a1000000-0000-4000-8000-0000000000a4";
const DEMO_TASK_ID = "b1000000-0000-4000-8000-0000000000a4";
const DEMO_BRIEF_ID = "d1000000-0000-4000-8000-0000000000a4";
const DEMO_CREATIVE_TASK_ID = "b2000000-0000-4000-8000-0000000000a4";
const DEMO_CLIENT_B_TASK_ID = "b1000000-0000-4000-8000-0000000000b4";

export type DemoDeliveryStatus = {
  clientId: string;
  status: string;
  updatedAt: string;
  lastSeam: string;
  taskId?: string;
  assetId?: string | null;
  spawnKey?: string;
};

export type DemoSeamOutboxRow = {
  eventId: string;
  name: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
  applied: boolean;
  result: Record<string, unknown> | null;
};

const MONTH1_PHASE_NAMES = [
  "Kickoff access",
  "Immersion complete",
  "Calendar draft",
  "Ref approve + shoot lock",
  "First assets in QC",
  "Client rhythm steady",
  "Month-1 close",
] as const;

const ONBOARDING_PHASE_NAMES = [
  "Kickoff & access",
  "Immersion & discovery",
  "Strategy lock",
  "Creative foundations",
  "Channel setup",
  "First delivery sprint",
  "Steady-state handoff",
] as const;

function seedOnboarding(): DemoOnboardingPhase[] {
  return ONBOARDING_PHASE_NAMES.map((name, i) => ({
    phaseId: randomUUID(),
    phaseIndex: i,
    name,
    status: i === 0 ? "active" : "pending",
    signedOffAt: null,
    steps: [
      {
        stepId: randomUUID(),
        title: `${name} — RACI owner confirm`,
        raci: i % 2 === 0 ? "AM" : "CS",
        done: false,
      },
      {
        stepId: randomUUID(),
        title: `${name} — artifact upload`,
        raci: "Creative",
        done: false,
      },
    ],
  }));
}

function initialDeal(): DemoDeal {
  return {
    dealId: DEMO_DEAL_ID,
    companyName: "Demo Co LLC",
    sector: "Retail",
    stage: "discover",
    closeOutcome: null,
    lostReason: null,
    leadSourceLane: "relationship_led",
    buafBudget: false,
    buafUrgency: false,
    buafAccess: false,
    buafFit: false,
    buafTemperature: null,
    noGoFlags: [],
    emailVerified: false,
    contactEmail: "alex@democo.example",
    voiceCheckPassed: false,
    quoteValue: "50000.00",
    internalCost: "30000.00",
    marginPct: "40.00",
    discountPct: "0.00",
    discountApprovalTier: null,
    vendorHandlingFeePct: VENDOR_FEE_DEFAULT_PCT.toFixed(2),
    quoteLines: [],
    ownerEmployeeId: DEMO_EMPLOYEE_ID,
    enrichment: null,
    commercialMode: "project",
  };
}

function initialEmployee(): DemoEmployee {
  return {
    employeeId: DEMO_EMPLOYEE_ID,
    displayName: "New Hire Candidate",
    email: "newhire@hrmny.local",
    lifecycleStatus: "offer",
    checklist: {},
    probationDueAt: null,
    escalatedAt: null,
    bayzatExternalId: null,
    spawnedBundle: false,
  };
}

/** Process-local store so demos work without DATABASE_URL. */
class MemoryDemoStore {
  deals = new Map<string, DemoDeal>([[DEMO_DEAL_ID, initialDeal()]]);
  /** M1 compat — primary demo deal mirror. */
  get deal(): DemoDeal {
    return this.deals.get(DEMO_DEAL_ID) ?? initialDeal();
  }
  set deal(value: DemoDeal) {
    this.deals.set(value.dealId, value);
  }

  audits: DemoAudit[] = [];
  assets = new Map<string, DemoAsset>();
  connections: DemoConnection[] = [];
  healthSignals: HealthSignal[] = [];
  objectStore: ObjectStore = createObjectStoreFromEnv();
  xero: XeroAdapter = createXeroAdapter();
  bayzat: BayzatAdapter = createBayzatAdapter({ source: "csv" });
  apollo: ApolloAdapter = createApolloAdapter();
  hunter: HunterAdapter = createHunterAdapter();
  composio: ComposioSendAdapter = createComposioStub();
  llm: LLMProvider = createProvider({ provider: "mock" });

  /** In-memory conventions-as-data (Director editable). */
  conventions = new Map<string, DemoConvention>([
    [
      "health.signals",
      {
        ruleKey: "health.signals",
        version: 1,
        payload: {
          signals: [
            "gate_blocked",
            "auth_denied",
            "dam_upload",
            "spend_cap",
            "job_lag",
          ],
        },
        updatedAt: new Date().toISOString(),
        updatedByEmployeeId: null,
      },
    ],
    [
      "margin.floor",
      {
        ruleKey: "margin.floor",
        version: 1,
        payload: { floorPct: 25, targetPct: 40 },
        updatedAt: new Date().toISOString(),
        updatedByEmployeeId: null,
      },
    ],
    [
      // Invited portal contacts for magic-link access (email → clientId).
      "portal.allowed_contacts",
      {
        ruleKey: "portal.allowed_contacts",
        version: 1,
        payload: {
          contacts: {
            "alex@democo.example": DEMO_CLIENT_ID,
            "ops@otherco.example": DEMO_CLIENT_B_ID,
          },
        },
        updatedAt: new Date().toISOString(),
        updatedByEmployeeId: null,
      },
    ],
  ]);

  /** Dev portal magic-link tokens (token → clientId binding, single-use). */
  portalMagicTokens = new Map<
    string,
    { token: string; clientId: string; email?: string; expiresAt: number }
  >();

  invoices = new Map<string, DemoInvoice>();
  proposals = new Map<string, DemoInvoiceProposal>();
  employees = new Map<string, DemoEmployee>([
    [DEMO_EMPLOYEE_ID, initialEmployee()],
  ]);
  requisitions = new Map<string, DemoRequisition>();
  payrollRuns = new Map<string, DemoPayrollRun>();
  escalations: DemoEscalation[] = [];
  bayzatMirror: BayzatEmployeeRow[] = [];
  /** Demo delivery cost override per client (margin engine). */
  clientDeliveryCost = new Map<string, number>();
  vatDocs = new Map<string, DemoVatDoc>();
  vatCloses = new Map<string, { period: string; closedAt: string }>();
  vatReturns = new Map<string, DemoVatReturn>();

  clients = new Map<string, DemoClient>();
  scopes = new Map<string, DemoScope>();
  immersions = new Map<string, DemoImmersion>();
  onboarding = new Map<string, DemoOnboardingPhase[]>();
  approvalQueue = new Map<string, DemoApprovalItem>();
  handoverPacks = new Map<string, DemoHandoverPack>();
  killSwitches: Record<string, boolean> = { gmail: false, linkedin: false };
  sentIdempotency = new Set<string>();

  calendars = new Map<string, DemoCalendar>();
  tasks = new Map<string, DemoTask>();
  briefs = new Map<string, DemoBrief>();
  month1 = new Map<string, DemoMonth1Phase[]>();
  deliveryEscalations: Array<{
    id: string;
    kind: string;
    calendarId: string;
    message: string;
    createdAt: string;
  }> = [];
  /** M6: portal-visible delivery status per client (no finance fields). */
  clientDeliveryStatus = new Map<string, DemoDeliveryStatus>();
  /** M6: Inngest-style seam outbox (idempotent). */
  seamOutbox: DemoSeamOutboxRow[] = [];
  /** Portal approval queue items scoped by client (not outreach). */
  portalApprovals = new Map<
    string,
    {
      approvalId: string;
      clientId: string;
      title: string;
      kind: "asset" | "calendar" | "brief";
      status: "pending" | "approved" | "rejected";
      entityId: string;
      slaHours: number;
      createdAt: string;
    }
  >();

  readonly roles: DemoRole[] = [
    {
      roleId: "a0000000-0000-4000-8000-000000000001",
      key: "partner",
      displayName: "Partner",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000002",
      key: "finance",
      displayName: "Finance",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000003",
      key: "am",
      displayName: "Account Manager",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000004",
      key: "director",
      displayName: "Director",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000007",
      key: "hr",
      displayName: "HR",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000005",
      key: "creative",
      displayName: "Creative",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000008",
      key: "creative_director",
      displayName: "Creative Director",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000009",
      key: "traffic",
      displayName: "Traffic",
    },
    {
      roleId: "a0000000-0000-4000-8000-000000000006",
      key: "developer",
      displayName: "Developer",
    },
  ];

  resetDemoDeal() {
    this.deals = new Map([[DEMO_DEAL_ID, initialDeal()]]);
  }

  resetM2Demo() {
    this.invoices.clear();
    this.proposals.clear();
    this.requisitions.clear();
    this.payrollRuns.clear();
    this.escalations = [];
    this.bayzatMirror = [];
    this.clientDeliveryCost.clear();
    this.vatDocs.clear();
    this.vatCloses.clear();
    this.vatReturns.clear();
    this.bayzat = createBayzatAdapter({ source: "csv" });
    this.xero = createXeroAdapter();
    this.employees = new Map([[DEMO_EMPLOYEE_ID, initialEmployee()]]);
  }

  resetM3Demo() {
    this.resetDemoDeal();
    this.clients.clear();
    this.scopes.clear();
    this.immersions.clear();
    this.onboarding.clear();
    this.approvalQueue.clear();
    this.handoverPacks.clear();
    this.sentIdempotency.clear();
    this.killSwitches = { gmail: false, linkedin: false };
    this.apollo = createApolloAdapter();
    this.hunter = createHunterAdapter();
    this.composio = createComposioStub();
  }

  seedM4Demo() {
    const shoot = new Date(Date.now() + 36 * 60 * 60 * 1000);
    const shootDate = shoot.toISOString();
    const month = shootDate.slice(0, 7);

    const client: DemoClient = {
      clientId: DEMO_CLIENT_ID,
      dealId: DEMO_DEAL_ID,
      name: "Demo Co LLC",
      market: "UAE",
      engagementType: "retainer",
      contractValue: "50000.00",
      currency: "AED",
      startDate: new Date().toISOString().slice(0, 10),
      renewalDate: new Date(Date.now() + 130 * 86400000)
        .toISOString()
        .slice(0, 10),
      fee: "50000.00",
      lifecycleStatus: "active",
      contacts: { primary: { email: "alex@democo.example" } },
      approvers: {},
    };
    this.clients.set(client.clientId, client);
    this.onboarding.set(client.clientId, seedOnboarding());
    this.month1.set(
      client.clientId,
      MONTH1_PHASE_NAMES.map((name, i) => ({
        phaseIndex: i,
        name,
        status: i === 0 ? "active" : "pending",
        gate: `month1.g${i}`,
      })),
    );

    const calendar: DemoCalendar = {
      calendarId: DEMO_CALENDAR_ID,
      clientId: DEMO_CLIENT_ID,
      month,
      focusPoints: ["Launch reel", "Product stills"],
      refApprovalState: "pending",
      finalApprovalState: null,
      shootDate,
      state: "ref_pending",
      slots: [
        {
          calendarSlotId: randomUUID(),
          calendarId: DEMO_CALENDAR_ID,
          slotDate: shootDate,
          slotLabel: "Studio shoot",
          taskId: DEMO_CREATIVE_TASK_ID,
          position: 1,
        },
      ],
    };
    this.calendars.set(calendar.calendarId, calendar);

    const dorTask: DemoTask = {
      taskId: DEMO_TASK_ID,
      clientId: DEMO_CLIENT_ID,
      calendarId: DEMO_CALENDAR_ID,
      month,
      taskType: "social_reel",
      title: "Launch reel brief (DoR demo)",
      status: "briefing",
      situationalState: null,
      ownerEmployeeId: null,
      deadline: shootDate,
      priority: "P1",
      qcPassed: false,
      qcNotes: null,
      clientRevisionCount: 0,
      revisionBoundaryAck: false,
      briefId: DEMO_BRIEF_ID,
    };
    this.tasks.set(dorTask.taskId, dorTask);

    const creativeTask: DemoTask = {
      taskId: DEMO_CREATIVE_TASK_ID,
      clientId: DEMO_CLIENT_ID,
      calendarId: DEMO_CALENDAR_ID,
      month,
      taskType: "social_reel",
      title: "Launch reel production (QC demo)",
      status: "qc",
      situationalState: null,
      ownerEmployeeId: DEMO_EMPLOYEE_ID,
      deadline: shootDate,
      priority: "P1",
      qcPassed: false,
      qcNotes: null,
      clientRevisionCount: 0,
      revisionBoundaryAck: false,
      briefId: null,
    };
    this.tasks.set(creativeTask.taskId, creativeTask);

    this.briefs.set(DEMO_BRIEF_ID, {
      briefId: DEMO_BRIEF_ID,
      taskId: DEMO_TASK_ID,
      body: { objective: "Grow retail awareness" },
      dorComplete: false,
      missingRequiredCount: 6,
      missing: [
        "audience",
        "deliverables",
        "deadline",
        "brandAssets",
        "channels",
        "successMetric",
      ],
      lockedAt: null,
    });

    const asset = this.createAsset(
      "Launch reel cut",
      DEMO_CLIENT_ID,
      DEMO_CREATIVE_TASK_ID,
    );
    asset.status = "qc";
  }

  resetM4Demo() {
    this.resetM3Demo();
    this.calendars.clear();
    this.tasks.clear();
    this.briefs.clear();
    this.month1.clear();
    this.deliveryEscalations = [];
    this.assets.clear();
    this.clientDeliveryStatus.clear();
    this.seamOutbox = [];
    this.portalApprovals.clear();
    this.seedM4Demo();
  }

  /** Isolation fixture: second client with own task/asset (portal_a must not see). */
  seedClientB() {
    const clientB: DemoClient = {
      clientId: DEMO_CLIENT_B_ID,
      dealId: DEMO_DEAL_ID,
      name: "Other Co FZ-LLC",
      market: "UAE",
      engagementType: "project",
      contractValue: "12000.00",
      currency: "AED",
      startDate: new Date().toISOString().slice(0, 10),
      renewalDate: new Date(Date.now() + 90 * 86400000)
        .toISOString()
        .slice(0, 10),
      fee: "12000.00",
      lifecycleStatus: "active",
      contacts: { primary: { email: "ops@otherco.example" } },
      approvers: {},
    };
    this.clients.set(clientB.clientId, clientB);
    const taskB: DemoTask = {
      taskId: DEMO_CLIENT_B_TASK_ID,
      clientId: DEMO_CLIENT_B_ID,
      calendarId: null,
      month: new Date().toISOString().slice(0, 7),
      taskType: "social_still",
      title: "Other Co secret campaign",
      status: "in_production",
      situationalState: null,
      ownerEmployeeId: null,
      deadline: null,
      priority: "P2",
      qcPassed: false,
      qcNotes: null,
      clientRevisionCount: 0,
      revisionBoundaryAck: false,
      briefId: null,
    };
    this.tasks.set(taskB.taskId, taskB);
    const assetB = this.createAsset(
      "Other Co confidential cut",
      DEMO_CLIENT_B_ID,
    );
    assetB.status = "internal_review";
    this.clientDeliveryStatus.set(DEMO_CLIENT_B_ID, {
      clientId: DEMO_CLIENT_B_ID,
      status: "in_production",
      updatedAt: new Date().toISOString(),
      lastSeam: "seed",
      taskId: DEMO_CLIENT_B_TASK_ID,
    });
  }

  seedPortalApprovals() {
    const asset = [...this.assets.values()].find(
      (a) => a.clientId === DEMO_CLIENT_ID,
    );
    if (!asset) return;
    const approvalId = "f1000000-0000-4000-8000-0000000000a1";
    this.portalApprovals.set(approvalId, {
      approvalId,
      clientId: DEMO_CLIENT_ID,
      title: "Approve launch reel cut",
      kind: "asset",
      status: "pending",
      entityId: asset.assetId,
      slaHours: 48,
      createdAt: new Date().toISOString(),
    });
  }

  resetM6Demo() {
    this.resetM5Demo();
    this.seamOutbox = [];
    this.clientDeliveryStatus.clear();
    this.portalApprovals.clear();
    this.seedClientB();
    this.seedPortalApprovals();
    this.clientDeliveryStatus.set(DEMO_CLIENT_ID, {
      clientId: DEMO_CLIENT_ID,
      status: "onboarding",
      updatedAt: new Date().toISOString(),
      lastSeam: "deal.won",
    });
  }

  /** Seed Bayzat mirror + retainer client + VAT docs for M5 money demo. */
  seedM5Demo() {
    this.resetM4Demo();
    this.bayzatMirror = [
      {
        externalId: "bz-hr-1",
        displayName: "Aubrey Chen",
        email: "aubrey@hrmny.local",
        department: "HR",
        basicSalaryAed: "18000.00",
        raw: {},
      },
      {
        externalId: "bz-ops-2",
        displayName: "Sam Lee",
        email: "sam@hrmny.local",
        department: "Ops",
        basicSalaryAed: "22000.00",
        raw: {},
      },
      {
        externalId: "bz-cre-3",
        displayName: "Maya Reed",
        email: "maya@hrmny.local",
        department: "Creative",
        basicSalaryAed: "20000.00",
        raw: {},
      },
    ];
    // Over-servicing: delivery cost above retainer fee for demo margin surfacing
    this.clientDeliveryCost.set(DEMO_CLIENT_ID, 62000);
    const period = new Date().toISOString().slice(0, 7);
    this.vatDocs.set("vat-doc-1", {
      docId: "vat-doc-1",
      period,
      title: "Supplier tax invoice — Studio rent",
      unread: true,
    });
    this.vatDocs.set("vat-doc-2", {
      docId: "vat-doc-2",
      period,
      title: "Input VAT — Software SaaS",
      unread: false,
    });
  }

  resetM5Demo() {
    this.resetM2Demo();
    this.seedM5Demo();
  }

  ensureBayzatMirrorForPayroll(): BayzatEmployeeRow[] {
    if (this.bayzatMirror.length === 0) {
      this.bayzatMirror = [
        {
          externalId: "bz-demo-1",
          displayName: "Demo Staff",
          email: "staff@hrmny.local",
          department: "Ops",
          basicSalaryAed: "15000.00",
          raw: {},
        },
      ];
    }
    return this.bayzatMirror;
  }

  buildPayrollLinesFromMirror(): {
    lines: DemoPayrollLine[];
    totalGross: string;
  } {
    const mirror = this.ensureBayzatMirrorForPayroll();
    const lines: DemoPayrollLine[] = mirror.map((row) => ({
      externalId: row.externalId,
      displayName: row.displayName,
      email: row.email,
      department: row.department ?? null,
      grossAmount: row.basicSalaryAed ?? "10000.00",
      currency: "AED",
    }));
    const total = lines.reduce((sum, l) => sum + Number(l.grossAmount), 0);
    return { lines, totalGross: total.toFixed(2) };
  }

  /** Per-client margin rows (v_client_margin demo engine). Partners/finance only. */
  computeClientMargins(): DemoClientMarginRow[] {
    return [...this.clients.values()].map((c) => {
      const deal = this.deals.get(c.dealId);
      const fee = Number(c.fee || c.contractValue || 0);
      const issued = [...this.invoices.values()].filter(
        (inv) =>
          inv.clientId === c.clientId &&
          (inv.status === "issued" || inv.status === "paid"),
      );
      const revenueToDate =
        issued.length > 0
          ? issued.reduce((s, inv) => s + Number(inv.amount), 0)
          : fee;
      const deliveryCost =
        this.clientDeliveryCost.get(c.clientId) ??
        Number(deal?.internalCost ?? fee * 0.6);
      const marginPct =
        revenueToDate > 0
          ? (((revenueToDate - deliveryCost) / revenueToDate) * 100).toFixed(2)
          : "0.00";
      const scope = [...this.scopes.values()].find(
        (s) => s.clientId === c.clientId,
      );
      const overServicing = deliveryCost > fee;
      const scopeVsActualPct =
        fee > 0 ? ((deliveryCost / fee) * 100).toFixed(2) : "0.00";
      return {
        clientId: c.clientId,
        clientName: c.name,
        fee: fee.toFixed(2),
        contractValue: c.contractValue,
        revenueToDate: revenueToDate.toFixed(2),
        deliveryCost: deliveryCost.toFixed(2),
        marginPct,
        marginAtSalePct: scope?.marginAtSalePct ?? null,
        dealMarginPct: deal?.marginPct ?? null,
        overServicing,
        scopeVsActualPct,
      };
    });
  }

  markVatDocRead(docId: string) {
    const doc = this.vatDocs.get(docId);
    if (!doc) return null;
    doc.unread = false;
    return doc;
  }

  unreadVatDocIds(period: string): string[] {
    return [...this.vatDocs.values()]
      .filter((d) => d.period === period && d.unread)
      .map((d) => d.docId);
  }

  listDealsForRoles(roles: string[]): DemoDeal[] {
    return [...this.deals.values()].map((d) =>
      stripMarginFields({ ...d }, roles),
    );
  }

  getDealForRoles(dealId: string, roles: string[]): DemoDeal | null {
    const d = this.deals.get(dealId);
    if (!d) return null;
    return stripMarginFields({ ...d }, roles);
  }

  canSeeMargin(roles: string[]) {
    return canViewMargin(roles);
  }

  appendAudit(input: Omit<DemoAudit, "auditEventId" | "createdAt">) {
    const row: DemoAudit = {
      ...input,
      auditEventId: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.audits.unshift(row);
    return row;
  }

  createAsset(
    title: string,
    clientId: string | null,
    taskId: string | null = null,
    workItemId: string | null = null,
  ) {
    const assetId = randomUUID();
    const asset: DemoAsset = {
      assetId,
      title,
      status: "draft",
      clientId,
      taskId,
      workItemId,
      qcPassed: false,
      versions: [],
    };
    this.assets.set(assetId, asset);
    return asset;
  }

  async uploadVersion(opts: {
    assetId: string;
    contentBase64: string;
    contentType: string;
    fileName: string;
    employeeId: string | null;
    isClientRevision?: boolean;
  }) {
    const asset = this.assets.get(opts.assetId);
    if (!asset) throw new Error("NOT_FOUND");
    const versionNumber =
      Math.max(0, ...asset.versions.map((version) => version.versionNumber)) + 1;
    const storagePath = `dam/${opts.assetId}/v${versionNumber}-${opts.fileName}`;
    const raw = Buffer.from(opts.contentBase64, "base64");
    const body = new Uint8Array(raw);
    const version: DemoAssetVersion = {
      assetVersionId: randomUUID(),
      assetId: opts.assetId,
      storagePath,
      versionNumber,
      isClientRevision: opts.isClientRevision ?? false,
      uploadedByEmployeeId: opts.employeeId,
      createdAt: new Date().toISOString(),
    };
    asset.versions = [...asset.versions, version];
    try {
      await this.objectStore.put({
        path: storagePath,
        body,
        contentType: opts.contentType,
      });
    } catch (error) {
      asset.versions = asset.versions.filter(
        (candidate) => candidate.assetVersionId !== version.assetVersionId,
      );
      try {
        await this.objectStore.remove?.(storagePath);
      } catch {
        // Preserve the upload failure; storage cleanup is best-effort here.
      }
      throw error;
    }
    this.appendAudit({
      actorEmployeeId:
        opts.employeeId ?? "00000000-0000-4000-8000-000000000000",
      action: "assets.uploadVersion",
      entityType: "asset",
      entityId: opts.assetId,
      before: null,
      after: { ...version },
      reason: null,
    });
    return version;
  }

  pushHealth(
    signalKey: string,
    severity: string,
    payload: Record<string, unknown>,
  ) {
    const row: HealthSignal = {
      signalKey,
      severity,
      payload,
      notifiedAt: null,
      deliveryStatus: process.env.GOOGLE_CHAT_WEBHOOK_URL
        ? "pending"
        : "not_configured",
      notificationAttempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    this.healthSignals.unshift(row);
    return row;
  }

  pushEscalation(employeeId: string, kind: string, message: string) {
    const row: DemoEscalation = {
      escalationId: randomUUID(),
      employeeId,
      kind,
      message,
      createdAt: new Date().toISOString(),
      notified: Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL),
    };
    this.escalations.unshift(row);
    this.pushHealth("hr_escalation", "warn", { employeeId, kind, message });
    return row;
  }

  createClientFromWonDeal(deal: DemoDeal): DemoClient {
    const start = new Date();
    const renewal = new Date(start);
    renewal.setDate(renewal.getDate() + 130);
    const client: DemoClient = {
      clientId: randomUUID(),
      dealId: deal.dealId,
      name: deal.companyName,
      market: "UAE",
      engagementType: deal.commercialMode,
      contractValue: deal.quoteValue,
      currency: "AED",
      startDate: start.toISOString().slice(0, 10),
      renewalDate: renewal.toISOString().slice(0, 10),
      fee: deal.quoteValue,
      lifecycleStatus: "onboarding",
      contacts: deal.contactEmail
        ? { primary: { email: deal.contactEmail } }
        : {},
      approvers: {},
    };
    this.clients.set(client.clientId, client);
    this.onboarding.set(client.clientId, seedOnboarding());
    return client;
  }
}

const globalStore = globalThis as typeof globalThis & {
  __hrmnyDemoStore?: MemoryDemoStore;
};

export function getDemoStore(): MemoryDemoStore {
  if (!globalStore.__hrmnyDemoStore) {
    globalStore.__hrmnyDemoStore = new MemoryDemoStore();
  }
  return globalStore.__hrmnyDemoStore;
}

export {
  DEMO_DEAL_ID,
  DEMO_EMPLOYEE_ID,
  DEMO_CLIENT_ID,
  DEMO_CLIENT_B_ID,
  DEMO_CALENDAR_ID,
  DEMO_TASK_ID,
  DEMO_BRIEF_ID,
  DEMO_CREATIVE_TASK_ID,
  DEMO_CLIENT_B_TASK_ID,
  ONBOARDING_PHASE_NAMES,
  MONTH1_PHASE_NAMES,
};
