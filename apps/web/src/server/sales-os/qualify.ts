import {
  DEFAULT_SALES_OS_SETTINGS,
  temperatureFromScore,
  type SalesOsSettings,
} from "./sops";

export type BuafBreakdown = {
  budget: number;
  urgency: number;
  access: number;
  fit: number;
  total: number;
  temperature: "hot" | "warm" | "cool" | "cold";
};

export type QualifyInput = {
  name: string;
  sector?: string | null;
  whyThis?: string | null;
  employeesGlobal?: number | null;
  employeesMena?: number | null;
  notes?: string | null;
};

const NO_GO_ALIASES: Record<string, string[]> = {
  Alcohol: ["alcohol", "beer", "wine", "spirits", "liquor"],
  Tobacco: ["tobacco", "cigarette", "vape", "nicotine"],
  "Low-budget startups": ["pre-seed", "bootstrapped startup", "no budget"],
  "Small local brands": ["mom and pop", "family stall"],
  "Crypto / Web3": ["crypto", "web3", "nft", "blockchain token", "defi"],
  Political: ["political party", "campaign politics", "electioneering"],
  "Spec-work": ["spec work", "speculative pitch unpaid"],
  Gambling: ["gambling", "casino", "betting", "wager"],
  Adult: ["adult entertainment", "porn"],
  "Unlicensed finance": ["unlicensed finance", "unregulated forex"],
};

export function matchesNoGo(
  input: QualifyInput,
  settings: SalesOsSettings = DEFAULT_SALES_OS_SETTINGS,
): string | null {
  const hay = [
    input.name,
    input.sector ?? "",
    input.whyThis ?? "",
    input.notes ?? "",
  ]
    .join(" ")
    .toLowerCase();
  for (const rule of settings.icp.noGo) {
    const aliases = NO_GO_ALIASES[rule] ?? [rule.toLowerCase()];
    if (aliases.some((a) => hay.includes(a.toLowerCase()))) return rule;
  }
  return null;
}

export function failsSizeFloor(
  input: QualifyInput,
  settings: SalesOsSettings = DEFAULT_SALES_OS_SETTINGS,
): boolean {
  const global = input.employeesGlobal;
  const mena = input.employeesMena;
  if (global == null && mena == null) return false;
  const globalOk = global != null && global >= settings.icp.minEmployeesGlobal;
  const menaOk = mena != null && mena >= settings.icp.minEmployeesMena;
  return !(globalOk || menaOk);
}

function clamp10(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

/** Heuristic 1–10 BUAF from research notes. Agent scores can replace this. */
export function scoreBuaf(
  input: QualifyInput,
  settings: SalesOsSettings = DEFAULT_SALES_OS_SETTINGS,
): BuafBreakdown {
  const text = `${input.whyThis ?? ""} ${input.notes ?? ""} ${input.sector ?? ""}`.toLowerCase();
  let budget = 5;
  let urgency = 5;
  let access = 5;
  let fit = 6;
  if (/(hiring|cmo|head of marketing|campaign|retainer)/.test(text)) budget += 2;
  if (/(flagship|launch|ramadan|opening|rfp)/.test(text)) urgency += 3;
  if (/(dubai|uae|mena|gcc)/.test(text)) access += 2;
  const primary = settings.icp.primarySectors.join(" ").toLowerCase();
  const secondary = settings.icp.secondarySectors.join(" ").toLowerCase();
  const sector = (input.sector ?? "").toLowerCase();
  if (
    sector &&
    (primary.includes(sector.split(" ")[0] ?? "") ||
      /retail|sport|wellness/.test(sector))
  ) {
    fit += 3;
  } else if (sector && (secondary.includes(sector) || /auto|ev/.test(sector))) {
    fit += 1;
  }
  if (failsSizeFloor(input, settings)) {
    budget -= 3;
    fit -= 2;
  }
  const breakdown = {
    budget: clamp10(budget),
    urgency: clamp10(urgency),
    access: clamp10(access),
    fit: clamp10(fit),
  };
  const total =
    breakdown.budget + breakdown.urgency + breakdown.access + breakdown.fit;
  return {
    ...breakdown,
    total,
    temperature: temperatureFromScore(total, settings),
  };
}

export function qualifyCompany(
  input: QualifyInput,
  settings: SalesOsSettings = DEFAULT_SALES_OS_SETTINGS,
):
  | { ok: false; reason: "no_go" | "size"; detail: string }
  | { ok: true; buaf: BuafBreakdown; rejectCold: boolean } {
  const noGo = matchesNoGo(input, settings);
  if (noGo) return { ok: false, reason: "no_go", detail: noGo };
  if (failsSizeFloor(input, settings)) {
    return {
      ok: false,
      reason: "size",
      detail: `Below ${settings.icp.minEmployeesGlobal} global / ${settings.icp.minEmployeesMena} MENA`,
    };
  }
  const buaf = scoreBuaf(input, settings);
  return { ok: true, buaf, rejectCold: buaf.temperature === "cold" };
}
