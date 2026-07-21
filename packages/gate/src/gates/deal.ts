import type { ActorContext, GateFn } from "../types";

/** Legal deal_stage_enum edges (8-state machine). */
export const DEAL_TRANSITIONS: Record<string, string[]> = {
  discover: ["qualify"],
  qualify: ["engage", "discover"],
  engage: ["scope", "qualify"],
  scope: ["propose", "engage"],
  propose: ["price_cost", "scope"],
  price_cost: ["close", "propose"],
  close: ["handover_pack"],
  handover_pack: [],
};

/** Gates that partners may override with overrideReason. */
export const DEAL_OVERRIDABLE_GATES = new Set([
  "deal.margin_floor",
  "deal.discount_authority",
  "deal.vendor_fee",
]);

export const MARGIN_FLOOR_PCT = 25;
export const MARGIN_TARGET_PCT = 40;
export const VENDOR_FEE_DEFAULT_PCT = 20;

export const NO_GO_SECTORS = ["alcohol", "tobacco", "gambling"] as const;

export type BuafInput = {
  budget: boolean;
  urgency: boolean;
  access: boolean;
  fit: boolean;
};

export type BuafTemperature = "hot" | "warm" | "cool" | "cold";

export function scoreBuaf(input: BuafInput): {
  temperature: BuafTemperature;
  hot: boolean;
  score: number;
} {
  const flags = [input.budget, input.urgency, input.access, input.fit];
  const score = flags.filter(Boolean).length;
  let temperature: BuafTemperature = "cold";
  if (score === 4) temperature = "hot";
  else if (score === 3) temperature = "warm";
  else if (score === 2) temperature = "cool";
  return { temperature, hot: score === 4, score };
}

export function discountAuthorityTier(
  discountPct: number,
): "am" | "md" | "partner" {
  if (discountPct <= 5) return "am";
  if (discountPct <= 15) return "md";
  return "partner";
}

function boolField(
  data: Record<string, unknown>,
  camel: string,
  snake: string,
): boolean {
  const v = data[camel] ?? data[snake];
  return v === true || v === "true";
}

function numField(
  data: Record<string, unknown>,
  camel: string,
  snake: string,
): number | null {
  const raw = data[camel] ?? data[snake];
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const dealLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = DEAL_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "deal.legal_transition",
      reason: `Illegal deal transition ${entity.state} → ${request.to}. Allowed: [${allowed.join(", ") || "none"}]`,
    };
  }
  return null;
};

/** G1: qualify→engage requires Fit + at least Warm (score ≥ 3). No-Go kills. */
export const dealBuafGate: GateFn = async ({ entity, request }) => {
  if (!(entity.state === "qualify" && request.to === "engage")) return null;

  const noGo = (entity.data.noGoFlags ?? entity.data.no_go_flags) as
    | string[]
    | undefined;
  if (Array.isArray(noGo) && noGo.length > 0) {
    return {
      gate: "deal.buaf_nogo",
      reason: `No-Go flags block outreach: ${noGo.join(", ")}`,
    };
  }

  const sector = String(entity.data.sector ?? "").toLowerCase();
  if (NO_GO_SECTORS.some((s) => sector.includes(s))) {
    return {
      gate: "deal.buaf_nogo",
      reason: `Sector "${sector}" is on the No-Go list`,
    };
  }

  const fit = boolField(entity.data, "buafFit", "buaf_fit");
  if (!fit) {
    return {
      gate: "deal.buaf",
      reason: "BUAF Fit is false — cannot advance to outreach (engage)",
    };
  }

  const scored = scoreBuaf({
    budget: boolField(entity.data, "buafBudget", "buaf_budget"),
    urgency: boolField(entity.data, "buafUrgency", "buaf_urgency"),
    access: boolField(entity.data, "buafAccess", "buaf_access"),
    fit,
  });
  if (scored.score < 3) {
    return {
      gate: "deal.buaf",
      reason: `BUAF temperature ${scored.temperature} (score ${scored.score}) — need Warm+ before outreach`,
    };
  }
  return null;
};

/** G2: engage→scope requires verified email (Apollo→Hunter). */
export const dealVerifiedEmailGate: GateFn = async ({ entity, request }) => {
  if (!(entity.state === "engage" && request.to === "scope")) return null;
  const verified = boolField(entity.data, "emailVerified", "email_verified");
  if (!verified) {
    return {
      gate: "deal.verified_email",
      reason: "Email not verified via Apollo→Hunter waterfall — GATE_BLOCKED",
    };
  }
  return null;
};

/** G3: engage→scope voice check (lightweight pass flag). */
export const dealVoiceGate: GateFn = async ({ entity, request }) => {
  if (!(entity.state === "engage" && request.to === "scope")) return null;
  const passed = boolField(entity.data, "voiceCheckPassed", "voice_check_passed");
  if (!passed) {
    return {
      gate: "deal.voice",
      reason: "Voice check not passed — run deals.voiceCheck before scope",
    };
  }
  return null;
};

/** G4: price_cost→close margin floor 25% (partner-overridable). */
export const dealMarginFloorGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "close") return null;
  const margin = numField(entity.data, "marginPct", "margin_pct");
  if (margin === null) return null;
  if (margin < MARGIN_FLOOR_PCT) {
    return {
      gate: "deal.margin_floor",
      reason: `Margin ${margin}% below floor ${MARGIN_FLOOR_PCT}% — OVERRIDE_REQUIRED`,
    };
  }
  return null;
};

/** G5: discount tier vs actor authority. */
export const dealDiscountAuthorityGate: GateFn = async ({
  actor,
  entity,
  request,
}) => {
  if (request.to !== "close") return null;
  const discount = numField(entity.data, "discountPct", "discount_pct");
  if (discount === null || discount <= 0) return null;
  const needed = discountAuthorityTier(discount);
  if (!actorHasDiscountTier(actor, needed)) {
    return {
      gate: "deal.discount_authority",
      reason: `Discount ${discount}% needs ${needed} authority — OVERRIDE_REQUIRED`,
    };
  }
  return null;
};

/** G6: vendor handling fee must be 20% unless partner override. */
export const dealVendorFeeGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "close") return null;
  const fee = numField(
    entity.data,
    "vendorHandlingFeePct",
    "vendor_handling_fee_pct",
  );
  if (fee === null) return null;
  if (Math.abs(fee - VENDOR_FEE_DEFAULT_PCT) > 0.001) {
    return {
      gate: "deal.vendor_fee",
      reason: `Vendor fee ${fee}% ≠ default ${VENDOR_FEE_DEFAULT_PCT}% — OVERRIDE_REQUIRED`,
    };
  }
  return null;
};

/** close→handover_pack requires won outcome. */
export const dealWonBeforeHandoverGate: GateFn = async ({ entity, request }) => {
  if (!(entity.state === "close" && request.to === "handover_pack")) return null;
  const outcome = String(
    entity.data.closeOutcome ?? entity.data.close_outcome ?? "",
  );
  if (outcome !== "won") {
    return {
      gate: "deal.won_before_handover",
      reason: "Handover Pack requires close_outcome=won",
    };
  }
  return null;
};

function actorHasDiscountTier(
  actor: ActorContext,
  needed: "am" | "md" | "partner",
): boolean {
  if (needed === "am") {
    return actor.roles.some((r) =>
      ["am", "md", "director", "partner", "finance"].includes(r),
    );
  }
  if (needed === "md") {
    return actor.roles.some((r) =>
      ["md", "director", "partner"].includes(r),
    );
  }
  return actor.roles.includes("partner");
}

export function computeQuoteMetrics(lines: QuoteLineInput[]): {
  quoteValue: number;
  internalCost: number;
  marginPct: number;
  vendorFeeTotal: number;
  vatAmount: number;
} {
  let sell = 0;
  let cost = 0;
  let vendorFeeTotal = 0;
  for (const line of lines) {
    const qty = line.qty ?? 1;
    const lineSell = line.unitSell * qty;
    const lineCost = line.unitCost * qty;
    sell += lineSell;
    cost += lineCost;
    if (line.isVendor) {
      vendorFeeTotal += lineCost * (VENDOR_FEE_DEFAULT_PCT / 100);
    }
  }
  const quoteValue = sell + vendorFeeTotal;
  const internalCost = cost + vendorFeeTotal;
  const marginPct =
    quoteValue > 0 ? ((quoteValue - internalCost) / quoteValue) * 100 : 0;
  const vatAmount = quoteValue * 0.05;
  return { quoteValue, internalCost, marginPct, vendorFeeTotal, vatAmount };
}

export type QuoteLineInput = {
  label: string;
  unitSell: number;
  unitCost: number;
  qty?: number;
  isVendor?: boolean;
};
