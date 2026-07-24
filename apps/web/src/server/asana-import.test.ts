import { describe, expect, it } from "vitest";
import { asanaDueAt, asanaItemType } from "./asana-import";

describe("Asana import mapping", () => {
  it("preserves task kinds and date-only deadlines", () => {
    expect(asanaItemType("milestone")).toBe("milestone");
    expect(asanaItemType("approval")).toBe("approval");
    expect(asanaItemType("default_task")).toBe("task");
    expect(asanaDueAt({ gid: "1", name: "Task", due_on: "2026-08-10" })).toBe(
      "2026-08-10T23:59:59.999Z",
    );
  });
});
