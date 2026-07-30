import { expect, test } from "vitest";
import { lineDiff } from "./draft-preview";

test("lineDiff marks removed, added, and unchanged lines", () => {
  const rows = lineDiff("hello\nold line\nsigned", "hello\nnew line\nsigned");
  expect(rows).toEqual([
    { sign: "-", line: "old line" },
    { sign: " ", line: "hello" },
    { sign: "+", line: "new line" },
    { sign: " ", line: "signed" },
  ]);
});

test("lineDiff on identical text yields only unchanged lines", () => {
  const rows = lineDiff("a\nb", "a\nb");
  expect(rows.every((r) => r.sign === " ")).toBe(true);
  expect(rows).toHaveLength(2);
});
