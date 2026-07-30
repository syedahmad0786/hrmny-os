import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmailVerificationMock,
  createLeadSourceMock,
} from "@hrmny/integrations";
import { resetCrmMemory } from "../crm/memory";
import { createMockRunAgent } from "./agent-run";
import type { MorningDigest } from "./digest";
import { runDailyLeadGen } from "./pipeline";

describe("runDailyLeadGen", () => {
  beforeEach(() => resetCrmMemory());

  it("scores fresh leads and delivers a ranked digest to the sink", async () => {
    let delivered: MorningDigest | null = null;
    const digest = await runDailyLeadGen(
      {
        leadSource: createLeadSourceMock(),
        verifier: createEmailVerificationMock(),
        runAgent: createMockRunAgent(),
        digestSink: (d) => {
          delivered = d;
        },
      },
      { query: "Fintech Dubai", titles: ["CMO", "CEO", "Founder"], perPage: 3 },
    );

    expect(digest.count).toBe(3);
    expect(delivered).toEqual(digest);
    // Ranked highest BUAF first.
    const scores = digest.leads.map((l) => l.buafScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("is idempotent — a second run of the same ICP produces zero fresh leads", async () => {
    const deps = {
      leadSource: createLeadSourceMock(),
      verifier: createEmailVerificationMock(),
      runAgent: createMockRunAgent(),
    };
    const criteria = { query: "Fintech Dubai", titles: ["CMO", "CEO"], perPage: 2 };

    const first = await runDailyLeadGen(deps, criteria);
    expect(first.count).toBe(2);

    const second = await runDailyLeadGen(deps, criteria);
    expect(second.count).toBe(0);
  });
});
