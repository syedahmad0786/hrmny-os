import { describe, expect, it } from "vitest";
import {
  dependencyBlockerLabel,
  rankStaffNavigation,
  staffWorkspaceFor,
  staffWorkspaceProfile,
  type StaffNavId,
} from "./staff-workspace";

describe("staff workspace policy", () => {
  it("fails closed when dependency visibility is unavailable", () => {
    expect(dependencyBlockerLabel(null)).toBe(
      "Dependency visibility unavailable",
    );
    expect(dependencyBlockerLabel(0)).toBe("No unresolved dependency");
    expect(dependencyBlockerLabel(2)).toBe("2 unresolved dependencies");
  });

  it.each([
    ["partner", "partner"],
    ["director", "director"],
    ["am", "am"],
    ["finance", "finance"],
    ["hr", "hr"],
    ["traffic", "traffic"],
    ["creative", "creative"],
    ["creative_director", "creative"],
    ["developer", "developer"],
    ["staff", "staff"],
  ] as const)("maps canonical role %s to %s", (role, expected) => {
    expect(staffWorkspaceProfile([role]).key).toBe(expected);
  });

  it("resolves canonical aliases and a deterministic multi-role precedence", () => {
    expect(staffWorkspaceProfile(["account_manager"]).key).toBe("am");
    expect(staffWorkspaceProfile(["creative_director"]).key).toBe("creative");
    expect(staffWorkspaceProfile(["finance", "director"]).key).toBe("director");
    expect(staffWorkspaceProfile(["custom_role"]).key).toBe("staff");
  });

  it("never promotes an action whose exact feature is unavailable", () => {
    const workspace = staffWorkspaceFor(
      ["finance"],
      new Set(["core.home", "work.my_tasks", "analytics.dashboards"]),
    );
    expect(workspace.primaryAction?.href).toBe("/work/my-tasks");
    expect(
      [
        workspace.primaryAction,
        ...workspace.supportingActions,
        ...workspace.moreActions,
      ].map((item) => item?.href),
    ).not.toContain("/finance");
  });

  it("keeps the staff-wide approval queue under More with partial features", () => {
    const workspace = staffWorkspaceFor(
      ["partner"],
      new Set(["core.home", "support.tickets"]),
    );
    expect(workspace.primaryAction).toBeNull();
    expect(workspace.supportingActions).toEqual([]);
    expect(workspace.moreActions.map((item) => item.href)).toEqual([
      "/approvals",
    ]);
  });

  it("keeps every enabled navigation destination reachable under primary or More", () => {
    const items: { id: StaffNavId; label: string }[] = [
      { id: "home", label: "Home" },
      { id: "sales", label: "Sales" },
      { id: "work", label: "Work" },
      { id: "delivery", label: "Delivery" },
      { id: "chat", label: "Chat" },
      { id: "support", label: "Support" },
      { id: "finance", label: "Finance" },
      { id: "insights", label: "Insights" },
      { id: "people", label: "People" },
      { id: "settings", label: "Settings" },
    ];
    const navigation = rankStaffNavigation(["hr"], items);
    expect(navigation.primary.map((item) => item.id)).toEqual([
      "home",
      "people",
      "work",
      "support",
    ]);
    expect(
      [...navigation.primary, ...navigation.more].map((item) => item.id).sort(),
    ).toEqual(items.map((item) => item.id).sort());
  });
});
