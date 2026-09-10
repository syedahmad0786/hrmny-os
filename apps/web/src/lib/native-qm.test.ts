import { describe, expect, it } from "vitest";
import { canOpenNativeQm } from "./native-qm";

describe("canOpenNativeQm", () => {
  it("allows only an active staff workspace", () => {
    expect(
      canOpenNativeQm({ actorType: "staff", employeeId: "staff-1" }),
    ).toBe(true);
    expect(
      canOpenNativeQm({ actorType: "portal", employeeId: "portal-1" }),
    ).toBe(false);
    expect(
      canOpenNativeQm({
        actorType: "staff",
        employeeId: "staff-1",
        workspacePreview: {},
      }),
    ).toBe(false);
  });
});
