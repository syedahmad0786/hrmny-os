import { afterEach, expect, it, vi } from "vitest";
import { isDiscoveryExecutionEnabled, listPendingDiscoveryDispatchHorizon } from "../sales-os/discovery-runs";
import {
  DISCOVERY_INTERPRET_EVENT,
  dispatchPendingDiscoveryJobs,
  executeDiscoveryInterpret,
  executeDiscoveryWake,
  scheduleDiscoveryInterpretation,
} from "./discovery";

vi.mock("../sales-os/discovery-runs", () => ({
  handleDiscoveryWake: vi.fn(),
  isDiscoveryExecutionEnabled: vi.fn(() => false),
  listPendingDiscoveryDispatchHorizon: vi.fn(),
  prepareDiscoveryDispatch: vi.fn(),
  recordDiscoveryDispatch: vi.fn(),
}));
vi.mock("../sales-os/discovery-n8n", () => ({ triggerDiscoveryN8n: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const now = Date.parse("2026-09-20T00:00:00Z");
const wake = {
  schemaVersion: 1,
  jobId: "00000000-0000-4000-8000-000000000001",
  programmeId: "00000000-0000-4000-8000-000000000002",
  scheduleGeneration: 2,
  runAt: new Date(now + 60_000).toISOString(),
};
const dependencies = () => ({
  now: () => now,
  sleepUntil: vi.fn(async (_at: string) => undefined),
  run: vi.fn(async (_event: unknown) => ({ status: "claimed", nextWakeAt: null })),
  dispatchPending: vi.fn(async () => undefined),
});

it("rejects malformed, private-data and beyond-horizon events before any work", async () => {
  for (const event of [
    { ...wake, jobId: "bad" },
    { ...wake, criteria: "private" },
    { ...wake, runAt: new Date(now + 86_400_001).toISOString() },
  ]) {
    const deps = dependencies();
    await expect(executeDiscoveryWake(event, deps)).rejects.toThrow();
    expect(deps.sleepUntil).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.dispatchPending).not.toHaveBeenCalled();
  }
});

it("waits for the nominal slot and then invokes the database-fenced run once", async () => {
  const deps = dependencies();
  await expect(executeDiscoveryWake(wake, deps)).resolves.toEqual({ status: "claimed", nextWakeAt: null });
  expect(deps.sleepUntil).toHaveBeenCalledWith(wake.runAt);
  expect(deps.run).toHaveBeenCalledOnce();
  expect(deps.run).toHaveBeenCalledWith(wake);
  expect(deps.dispatchPending).toHaveBeenCalledOnce();
  expect(deps.sleepUntil.mock.invocationCallOrder[0]).toBeLessThan(deps.run.mock.invocationCallOrder[0]!);
});

it("rejects a malformed interpret event before the durable worker runs", async () => {
  const run = vi.fn(async () => ({ status: "completed", remaining: 0 }));
  await expect(
    executeDiscoveryInterpret({ jobId: "bad" }, { run }),
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it("reschedules remaining interpret work and does not reschedule a cancelled or unavailable job", async () => {
  const interpret = {
    schemaVersion: 1 as const,
    jobId: "00000000-0000-4000-8000-000000000001",
    sourceKey: "campaign_me",
    attemptToken: "00000000-0000-4000-8000-000000000004",
    attemptGeneration: 1,
  };
  const sendEvent = vi.fn(async () => undefined);
  const run = vi.fn(async () => ({ status: "pending", remaining: 92 }));
  await expect(
    executeDiscoveryInterpret(interpret, { run, sendEvent }),
  ).resolves.toEqual({ status: "pending", remaining: 92 });
  expect(sendEvent).toHaveBeenCalledWith({
    id: `discovery-interpret:${interpret.jobId}:${interpret.attemptToken}:${interpret.sourceKey}:pending:92`,
    name: DISCOVERY_INTERPRET_EVENT,
    data: interpret,
  });
  sendEvent.mockClear();
  run.mockResolvedValueOnce({ status: "cancelled", remaining: 3 });
  await expect(
    executeDiscoveryInterpret(interpret, { run, sendEvent }),
  ).resolves.toEqual({ status: "cancelled", remaining: 3 });
  expect(sendEvent).not.toHaveBeenCalled();
});

it("does not enqueue collector wakes while execution is disabled", async () => {
  vi.mocked(isDiscoveryExecutionEnabled).mockReturnValue(false);
  await expect(dispatchPendingDiscoveryJobs()).resolves.toEqual({
    status: "execution_disabled",
    nextWakeAt: null,
    results: [],
  });
  expect(listPendingDiscoveryDispatchHorizon).not.toHaveBeenCalled();
});

it("does not enqueue interpretation work while execution is disabled", async () => {
  vi.mocked(isDiscoveryExecutionEnabled).mockReturnValue(false);
  await expect(
    scheduleDiscoveryInterpretation({
      jobId: "00000000-0000-4000-8000-000000000003",
      sourceKey: "campaign_me",
      attemptToken: "00000000-0000-4000-8000-000000000004",
      attemptGeneration: 1,
    }),
  ).resolves.toEqual({ status: "execution_disabled" });
});

it("propagates an uncertain trigger so the same durable step retries the same database fence", async () => {
  const deps = dependencies();
  deps.run.mockRejectedValueOnce(new Error("N8N_DELIVERY_UNCERTAIN"));
  await expect(executeDiscoveryWake(wake, deps)).rejects.toThrow("N8N_DELIVERY_UNCERTAIN");
  expect(deps.dispatchPending).not.toHaveBeenCalled();
});
