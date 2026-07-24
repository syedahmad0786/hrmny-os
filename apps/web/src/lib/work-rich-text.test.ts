import { describe, expect, it } from "vitest";
import {
  parseWorkRichTextInline,
  workMentionEmployeeIds,
} from "./work-rich-text";

describe("work rich text", () => {
  it("parses safe formatting, links, and deduplicated person mentions", () => {
    const employeeId = "c0000000-0000-4000-8000-000000000001";
    const value = `**Bold** __under__ ~done~ \`code\` [site](https://example.com) @[Dev Partner](person:${employeeId}) @[Again](person:${employeeId})`;
    expect(parseWorkRichTextInline(value).map((token) => token.type)).toEqual([
      "bold",
      "text",
      "underline",
      "text",
      "strike",
      "text",
      "code",
      "text",
      "link",
      "text",
      "mention",
      "text",
      "mention",
    ]);
    expect(workMentionEmployeeIds(value)).toEqual([employeeId]);
    expect(parseWorkRichTextInline("[bad](javascript:alert(1))")).toEqual([
      { type: "text", value: "[bad](javascript:alert(1))" },
    ]);
  });
});
