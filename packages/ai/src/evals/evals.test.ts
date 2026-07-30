import { describe, expect, it } from "vitest";
import { createMockProvider } from "../provider";
import {
  OUTREACH_CASES,
  REPLY_INTENT_CASES,
  runOutreachEval,
  runReplyIntentEval,
} from "./golden";

describe("eval harness (mock provider)", () => {
  const provider = createMockProvider();

  it("has ~10 golden cases per suite", () => {
    expect(OUTREACH_CASES).toHaveLength(10);
    expect(REPLY_INTENT_CASES).toHaveLength(10);
  });

  it("outreach-draft: every golden case passes", async () => {
    const summary = await runOutreachEval(provider);
    const failed = summary.results.filter((r) => !r.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    expect(summary.passed).toBe(summary.total);
  });

  it("reply-intent: every golden case classifies correctly", async () => {
    const summary = await runReplyIntentEval(provider);
    const failed = summary.results.filter((r) => !r.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toHaveLength(0);
    expect(summary.passed).toBe(summary.total);
  });
});
