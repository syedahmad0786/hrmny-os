import { describe, expect, it } from "vitest";
import { canViewMargin, stripMarginFields, hasPermission } from "./rbac";

describe("RBAC margin exclusion", () => {
  it("denies margin for AM even if partner is somehow listed second", () => {
    expect(canViewMargin(["am"])).toBe(false);
    expect(canViewMargin(["am", "partner"])).toBe(false);
  });

  it("allows margin for partner and finance", () => {
    expect(canViewMargin(["partner"])).toBe(true);
    expect(canViewMargin(["finance"])).toBe(true);
  });

  it("strips margin fields from deal payloads for AM", () => {
    const deal = {
      dealId: "d1",
      companyName: "Acme",
      stage: "propose",
      marginPct: "42.00",
      internalCost: "1000.00",
      quoteValue: "5000.00",
    };
    const stripped = stripMarginFields(deal, ["am"]);
    expect(stripped.companyName).toBe("Acme");
    expect(stripped.quoteValue).toBe("5000.00");
    expect("marginPct" in stripped).toBe(false);
    expect("internalCost" in stripped).toBe(false);
  });

  it("keeps margin fields for partner", () => {
    const deal = { marginPct: "42.00", internalCost: "1000.00" };
    expect(stripMarginFields(deal, ["partner"])).toEqual(deal);
  });

  it("honors explicit deny over allow", () => {
    const perms = ["allow:deal:read", "deny:margin:view"];
    expect(hasPermission(perms, "margin", "view")).toBe(false);
    expect(hasPermission(perms, "deal", "read")).toBe(true);
  });
});
