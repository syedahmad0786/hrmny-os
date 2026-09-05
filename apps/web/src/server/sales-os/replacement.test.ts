process.env.DATABASE_URL = "";
import { beforeEach, expect, it, vi } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  createActivity,
  createCompany,
  listActivities,
  listCompanies,
} from "../crm/repository";
import { resetSalesOsStore } from "./store";
import {
  resetIntegrationReceiptMemory,
  listEmployeeOperationReceipts,
} from "../integrations/inbox";
import {
  resetLeadgenStore,
  insertOutreach,
  patchOutreach,
} from "../leadgen/store";
import {
  discoverSalesOpportunities,
  validateDiscoveryCandidate,
} from "./discovery";
import { linkedinProfileUrl } from "@/lib/linkedin-profile";
import {
  recordManualLinkedInSend,
  recordLinkedInAcceptance,
} from "./linkedin-assist";
import { prepareSalesMeeting } from "./workspace";
import type { RunAgent } from "../leadgen/agent-run";

const owner = "c0000000-0000-4000-8000-000000000001";
const colleague = "c0000000-0000-4000-8000-000000000002";
const other = "c0000000-0000-4000-8000-000000000003";
const now = new Date("2026-09-05T08:00:00Z");
const candidate = {
  name: "Cedar Retail Group",
  website: "https://cedar-retail.ae",
  sector: "retail",
  kind: "news",
  publishedOn: "2026-09-01",
  evidence: "https://cedar-retail.ae/news/launch",
  excerpt: "The company announced a new UAE retail launch this September.",
  whyNow:
    "The announced UAE launch may create demand for local creative production.",
  service: "Launch campaign",
};
beforeEach(() => {
  resetCrmMemory();
  resetSalesOsStore();
  resetIntegrationReceiptMemory();
  resetLeadgenStore();
});

it("rejects stale, future, invented-date, uncited, homepage and closed-tender evidence", () => {
  for (const patch of [
    { publishedOn: "2026-07-01" },
    { publishedOn: "2026-09-06" },
    { publishedOn: "2026-02-30" },
    { kind: "hiring", publishedOn: "2026-08-20" },
    { evidence: "https://cedar-retail.ae/" },
    { kind: "tender", deadline: "2026-09-04" },
    { evidence: "https://www.linkedin.com/in/sample" },
  ])
    expect(() =>
      validateDiscoveryCandidate({ ...candidate, ...patch }, now),
    ).toThrow();
  expect(() => validateDiscoveryCandidate(candidate, now, new Set())).toThrow(
    /citations/,
  );
  expect(validateDiscoveryCandidate(candidate, now).name).toBe(candidate.name);
});

it("discovers once, deduplicates the next run, and retains an owned review receipt without promoting CRM", async () => {
  const count = (await listCompanies()).length;
  const input = {
    actorEmployeeId: owner,
    roles: ["partner"],
    requestId: "research-test-1",
    focus: "retail",
    mode: "signals" as const,
  };
  const runAgent: RunAgent = vi.fn(async (input) => ({
    agent: input.agent,
    model: "test",
    output: { candidates: [candidate] },
    sourceCitations: [{ url: candidate.evidence }],
    inputTokens: 1,
    outputTokens: 1,
    costAed: 0,
    gateOutcome: "pending" as const,
  }));
  const result = await discoverSalesOpportunities(input, { runAgent, now });
  expect(result.proposed).toBe(1);
  expect(await listCompanies()).toHaveLength(count);
  expect(await discoverSalesOpportunities(input, { runAgent, now })).toEqual(
    result,
  );
  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(
    (
      await discoverSalesOpportunities(
        { ...input, requestId: "research-test-2" },
        { runAgent, now },
      )
    ).rejected,
  ).toBe(1);
  expect(await listEmployeeOperationReceipts(other, "sales.discovery")).toEqual(
    [],
  );
});

it("opens only valid public profile URLs and records manual sends once with an employee-bound acceptance", async () => {
  expect(
    linkedinProfileUrl("https://www.linkedin.com/in/sample?message=secret#x"),
  ).toBe("https://www.linkedin.com/in/sample");
  for (const url of [
    "javascript:alert(1)",
    "https://linkedin.com.evil.org/in/a",
    "https://www.linkedin.com/messaging/compose",
    "https://evil@linkedin.com/in/a",
    "http://linkedin.com/in/a",
  ])
    expect(linkedinProfileUrl(url)).toBeNull();
  const item = await insertOutreach({
    dealId: crypto.randomUUID(),
    channel: "linkedin_connect",
    recipient: "https://www.linkedin.com/in/sample",
    body: "Hello, would be good to connect.",
    cadenceTouch: 1,
  });
  await expect(recordLinkedInAcceptance(item.id, owner)).rejects.toThrow();
  await patchOutreach(item.id, { state: "approved" });
  await recordManualLinkedInSend(item.id, owner);
  expect((await recordManualLinkedInSend(item.id, owner))?.state).toBe("sent");
  await expect(recordManualLinkedInSend(item.id, other)).rejects.toThrow(
    /another employee/,
  );
  await expect(recordLinkedInAcceptance(item.id, other)).rejects.toThrow();
  expect(
    (await recordLinkedInAcceptance(item.id, owner))?.acceptedAt,
  ).toBeTruthy();
});

it("allows both named archive readers, excludes other employees and keeps new private briefs and AI context employee-bound", async () => {
  const company = await createCompany({ name: "Cedar Research" });
  await createActivity({
    type: "email",
    companyId: company.companyId,
    subject: "Private negotiation",
    body: "Confidential archive body",
    metadata: {
      visibility: "private",
      authorizedEmployeeIds: [owner, colleague],
    },
  });
  expect(await listActivities({ companyId: company.companyId })).toEqual([]);
  expect(
    await listActivities({
      companyId: company.companyId,
      viewerEmployeeId: other,
    }),
  ).toEqual([]);
  for (const viewerEmployeeId of [owner, colleague])
    expect(
      (
        await listActivities({ companyId: company.companyId, viewerEmployeeId })
      )[0]?.body,
    ).toBe("Confidential archive body");
  const runAgent: RunAgent = vi.fn(async (input) => ({
    agent: input.agent,
    model: "test",
    output: "Dated briefing with uncertainty and discovery questions.",
    sourceCitations: input.webSearch ? [{ url: candidate.evidence }] : [],
    inputTokens: 1,
    outputTokens: 1,
    costAed: 0,
    gateOutcome: "pending" as const,
  }));
  const token = vi.fn(async (employeeId) => {
    expect(employeeId).toBe(owner);
    return "owner-token";
  });
  await prepareSalesMeeting(
    {
      companyId: company.companyId,
      actorEmployeeId: owner,
      requestId: crypto.randomUUID(),
      goal: "Scope a campaign",
      roles: ["partner"],
    },
    { runAgent, token, workspace: async () => ({ sources: [], coverage: [] }) },
  );
  const calls = vi.mocked(runAgent).mock.calls;
  expect(calls[0]?.[0].context).toBeUndefined();
  expect(calls[1]?.[0]).toMatchObject({ privateContext: true });
  expect(calls[1]?.[0].webSearch).toBeUndefined();
  expect(
    await listEmployeeOperationReceipts(colleague, "sales.meeting"),
  ).toEqual([]);
  expect(
    await listEmployeeOperationReceipts(owner, "sales.meeting"),
  ).toHaveLength(1);
});
