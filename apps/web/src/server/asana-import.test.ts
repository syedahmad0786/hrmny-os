import { describe, expect, it } from "vitest";
import {
  asanaColor,
  asanaDueAt,
  asanaGoalProgress,
  asanaGoalStatus,
  asanaItemType,
  asanaObjectFieldDisplayValue,
  asanaObjectFieldValue,
  importAsanaWorkspace,
} from "./asana-import";

describe("Asana import mapping", () => {
  it("preserves task kinds and date-only deadlines", () => {
    expect(asanaItemType("milestone")).toBe("milestone");
    expect(asanaItemType("approval")).toBe("approval");
    expect(asanaItemType("default_task")).toBe("task");
    expect(asanaDueAt({ gid: "1", name: "Task", due_on: "2026-08-10" })).toBe(
      "2026-08-10T23:59:59.999Z",
    );
  });

  it("maps Asana planning fields without losing valid edge states", () => {
    expect(asanaColor("light-blue")).toBe("#5B8DEF");
    expect(asanaGoalStatus("green")).toBe("on_track");
    expect(asanaGoalStatus("partial")).toBe("partial");
    expect(
      asanaGoalProgress({
        gid: "g1",
        name: "Revenue",
        metric: {
          initial_number_value: 100,
          target_number_value: 300,
          current_number_value: 250,
        },
      }),
    ).toBe(75);
    expect(
      asanaObjectFieldValue({
        gid: "cf1",
        name: "Markets",
        multi_enum_values: [{ name: "UAE" }, { name: "KSA" }],
      }),
    ).toEqual(["UAE", "KSA"]);
    expect(
      asanaObjectFieldDisplayValue({
        gid: "cf2",
        name: "Budget",
        number_value: 0,
      }),
    ).toBe("0");
    expect(
      asanaObjectFieldValue({
        gid: "cf3",
        name: "Launch",
        date_value: { date: "2026-08-01", date_time: null },
      }),
    ).toBe("2026-08-01");
  });

  it("refuses a partial scan before reconciliation can change data", async () => {
    await expect(
      importAsanaWorkspace({
        db: {} as never,
        scan: { depth: "structure" } as never,
        workspaceGid: "w1",
        workspaceName: "Main",
        connectedAccountId: "ca1",
        actorEmployeeId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("requires a full scan");
  });
});
