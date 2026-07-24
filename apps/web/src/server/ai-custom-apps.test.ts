import { describe, expect, it } from "vitest";
import {
  availableReportMetrics,
  canAccessCustomApp,
  canUseReportMetrics,
  proposeReport,
  validateCustomAppRecord,
} from "./ai-custom-apps";

describe("AI reports and custom apps safety", () => {
  it("validates custom records strictly against admin-defined fields", () => {
    const fields = [
      {
        key: "client_email",
        label: "Client email",
        type: "email",
        required: true,
      },
      {
        key: "priority",
        label: "Priority",
        type: "enum",
        required: true,
        options: ["normal", "urgent"],
      },
      { key: "budget", label: "Budget", type: "number", required: false },
    ];

    expect(
      validateCustomAppRecord(fields, {
        client_email: "client@example.com",
        priority: "urgent",
        budget: 1_500,
      }),
    ).toEqual({
      client_email: "client@example.com",
      priority: "urgent",
      budget: 1_500,
    });
    expect(() =>
      validateCustomAppRecord(fields, {
        client_email: "not-an-email",
        priority: "unknown",
        injected: "reject unknown keys",
      }),
    ).toThrow();
  });

  it("enforces app scopes and proposes only allowlisted metrics", () => {
    const financeApp = {
      accessScope: "roles" as const,
      allowedRoles: ["finance"],
    };
    expect(canAccessCustomApp(["finance"], financeApp)).toBe(true);
    expect(canAccessCustomApp(["staff"], financeApp)).toBe(false);
    expect(
      canAccessCustomApp(["partner"], {
        accessScope: "admin_only",
        allowedRoles: [],
      }),
    ).toBe(true);

    const financeMetrics = availableReportMetrics(["finance"]);
    expect(
      financeMetrics.some((metric) => metric.key === "payroll.total_gross"),
    ).toBe(true);
    expect(
      financeMetrics.some((metric) => metric.key === "leave.requests"),
    ).toBe(false);
    expect(canUseReportMetrics(["finance"], ["payroll.total_gross"])).toBe(
      true,
    );
    expect(canUseReportMetrics(["staff"], ["payroll.total_gross"])).toBe(false);
    expect(
      proposeReport("Show payroll and expenses", ["finance"]).metrics,
    ).toEqual(["payroll.total_gross", "expenses.approved_total"]);
  });
});
