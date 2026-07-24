export const UAE_GRATUITY_RULE = "uae-fd33-2021-art51@2025-10-06";

const MONEY_RE = /^\d+(?:\.\d{1,2})?$/;

export function moneyToFils(value: string): number {
  if (!MONEY_RE.test(value)) throw new Error("INVALID_MONEY");
  const [whole, fraction = ""] = value.split(".");
  const fils = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(fils)) throw new Error("MONEY_OUT_OF_RANGE");
  return fils;
}

export function filsToMoney(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error("INVALID_FILS");
  return `${value < 0 ? "-" : ""}${Math.floor(Math.abs(value) / 100)}.${String(
    Math.abs(value) % 100,
  ).padStart(2, "0")}`;
}

function divideRounded(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || denominator <= 0) {
    throw new Error("INVALID_CALCULATION");
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export type PayrollLineInput = {
  basicMonthly: string;
  housingMonthly?: string;
  transportMonthly?: string;
  otherAllowanceMonthly?: string;
  calendarDays: number;
  paidDays: number;
  overtime?: string;
  bonus?: string;
  expenseReimbursement?: string;
  deductions?: string;
  loanDeduction?: string;
};

export function calculatePayrollLine(input: PayrollLineInput) {
  if (
    !Number.isInteger(input.calendarDays) ||
    !Number.isInteger(input.paidDays) ||
    input.calendarDays < 1 ||
    input.paidDays < 0 ||
    input.paidDays > input.calendarDays
  ) {
    throw new Error("INVALID_PRORATION_DAYS");
  }

  const prorate = (value = "0") =>
    divideRounded(moneyToFils(value) * input.paidDays, input.calendarDays);
  const basic = prorate(input.basicMonthly);
  const housing = prorate(input.housingMonthly);
  const transport = prorate(input.transportMonthly);
  const otherAllowance = prorate(input.otherAllowanceMonthly);
  const overtime = moneyToFils(input.overtime ?? "0");
  const bonus = moneyToFils(input.bonus ?? "0");
  const expenses = moneyToFils(input.expenseReimbursement ?? "0");
  const deductions = moneyToFils(input.deductions ?? "0");
  const loan = moneyToFils(input.loanDeduction ?? "0");
  const gross = basic + housing + transport + otherAllowance + overtime + bonus;
  const net = gross + expenses - deductions - loan;
  if (net < 0) throw new Error("NEGATIVE_NET_PAY");

  return {
    basic: filsToMoney(basic),
    housing: filsToMoney(housing),
    transport: filsToMoney(transport),
    otherAllowance: filsToMoney(otherAllowance),
    overtime: filsToMoney(overtime),
    bonus: filsToMoney(bonus),
    expenseReimbursement: filsToMoney(expenses),
    deductions: filsToMoney(deductions),
    loanDeduction: filsToMoney(loan),
    gross: filsToMoney(gross),
    net: filsToMoney(net),
  };
}

/** Advisory calculation; payroll approval must confirm the effective rule version. */
export function calculateUaeGratuity(input: {
  basicMonthly: string;
  eligibleServiceDays: number;
  workRatioBps?: number;
}) {
  const workRatioBps = input.workRatioBps ?? 10_000;
  if (
    !Number.isInteger(input.eligibleServiceDays) ||
    input.eligibleServiceDays < 0 ||
    !Number.isInteger(workRatioBps) ||
    workRatioBps < 0 ||
    workRatioBps > 10_000
  ) {
    throw new Error("INVALID_SERVICE_INPUT");
  }
  const basic = moneyToFils(input.basicMonthly);
  if (input.eligibleServiceDays < 365) {
    return { amount: "0.00", ruleVersion: UAE_GRATUITY_RULE };
  }

  const firstFiveDays = Math.min(input.eligibleServiceDays, 365 * 5);
  const laterDays = Math.max(0, input.eligibleServiceDays - 365 * 5);
  const weightedDays = firstFiveDays * 21 + laterDays * 30;
  const fullTime = divideRounded(basic * weightedDays, 30 * 365);
  const adjusted = divideRounded(fullTime * workRatioBps, 10_000);
  const capped = Math.min(adjusted, basic * 24);
  return { amount: filsToMoney(capped), ruleVersion: UAE_GRATUITY_RULE };
}
