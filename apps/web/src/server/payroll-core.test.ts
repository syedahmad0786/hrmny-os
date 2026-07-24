import { describe, expect, it } from "vitest";
import {
  UAE_GRATUITY_RULE,
  calculatePayrollLine,
  calculateUaeGratuity,
  filsToMoney,
  moneyToFils,
} from "./payroll-core";

describe("durable payroll calculations", () => {
  it("uses integer fils for proration and net pay", () => {
    expect(moneyToFils("1.05")).toBe(105);
    expect(filsToMoney(105)).toBe("1.05");
    expect(
      calculatePayrollLine({
        basicMonthly: "9000.00",
        housingMonthly: "3000.00",
        calendarDays: 30,
        paidDays: 15,
        overtime: "250.00",
        expenseReimbursement: "100.00",
        deductions: "50.00",
        loanDeduction: "500.00",
      }),
    ).toMatchObject({ gross: "6250.00", net: "5800.00" });
  });

  it("implements the versioned Article 51 gratuity bands and cap", () => {
    expect(
      calculateUaeGratuity({
        basicMonthly: "3000.00",
        eligibleServiceDays: 365 * 3,
      }),
    ).toEqual({ amount: "6300.00", ruleVersion: UAE_GRATUITY_RULE });
    expect(
      calculateUaeGratuity({
        basicMonthly: "3000.00",
        eligibleServiceDays: 365 * 40,
      }).amount,
    ).toBe("72000.00");
  });

  it("rejects malformed money, invalid proration and negative net pay", () => {
    expect(() => moneyToFils("1.001")).toThrow("INVALID_MONEY");
    expect(() =>
      calculatePayrollLine({
        basicMonthly: "100.00",
        calendarDays: 30,
        paidDays: 31,
      }),
    ).toThrow("INVALID_PRORATION_DAYS");
    expect(() =>
      calculatePayrollLine({
        basicMonthly: "100.00",
        calendarDays: 30,
        paidDays: 30,
        deductions: "101.00",
      }),
    ).toThrow("NEGATIVE_NET_PAY");
  });
});
