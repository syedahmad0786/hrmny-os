import { z } from "zod";
import { inngest, inngestCloudConfigured } from "./client";
import {
  listPendingDiscoveryInterpretationJobs,
} from "../sales-os/discovery-callback-ingest";
import {
  handleDiscoveryWake,
  isDiscoveryExecutionEnabled,
  listPendingDiscoveryDispatchHorizon,
  prepareDiscoveryDispatch,
  recordDiscoveryDispatch,
  type DiscoveryWakeEventV1,
} from "../sales-os/discovery-runs";
import { triggerDiscoveryN8n } from "../sales-os/discovery-n8n";

export const DISCOVERY_WAKE_EVENT = "sales/discovery.wake.v1" as const;
const DAY_MS = 24 * 60 * 60 * 1_000;
export const DiscoveryWakeEventSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().uuid(),
  programmeId: z.string().uuid(),
  scheduleGeneration: z.number().int().nonnegative(),
  runAt: z.string().datetime({ offset: true }),
}).strict();

/** A dispatch reservation is durable before the network request. */
export async function dispatchDiscoveryJob(jobId: string) {
  if (!isDiscoveryExecutionEnabled()) return { status: "execution_disabled" };
  if (!inngestCloudConfigured()) return { status: "scheduler_unavailable" };
  const prepared = await prepareDiscoveryDispatch(jobId);
  if (prepared.status !== "ready") return prepared;
  const event = DiscoveryWakeEventSchema.parse(prepared.event);
  try {
    const { ids } = await inngest.send({
      id: prepared.eventId,
      name: DISCOVERY_WAKE_EVENT,
      data: event,
    });
    const providerReceiptId = ids[0];
    await recordDiscoveryDispatch({
      jobId,
      dispatchToken: prepared.dispatchToken,
      eventId: prepared.eventId,
      ...(providerReceiptId ? { providerReceiptId } : {}),
      ok: Boolean(providerReceiptId),
      ...(!providerReceiptId ? { errorCode: "SCHEDULER_RECEIPT_MISSING" } : {}),
    });
    return { status: providerReceiptId ? "dispatched" : "repair_needed" };
  } catch {
    await recordDiscoveryDispatch({
      jobId,
      dispatchToken: prepared.dispatchToken,
      eventId: prepared.eventId,
      ok: false,
      errorCode: "SCHEDULER_DISPATCH_FAILED",
    });
    return { status: "repair_needed" };
  }
}

/** Called immediately after publication/run creation and by the independent repair clock. */
export async function dispatchPendingDiscoveryJobs() {
  if (!isDiscoveryExecutionEnabled())
    return { status: "execution_disabled", nextWakeAt: null, results: [] };
  const pending = await listPendingDiscoveryDispatchHorizon({ limit: 25 });
  const results: Array<{ jobId: string; status: string }> = [];
  for (const event of pending.events) {
    const result = await dispatchDiscoveryJob(event.jobId);
    results.push({ jobId: event.jobId, status: result.status });
  }
  return { status: pending.status, nextWakeAt: pending.nextWakeAt, results };
}

/** Claim + trigger share one durable step so a crash before POST can retry its fenced claim. */
export async function runDiscoveryWake(event: DiscoveryWakeEventV1) {
  const result = await handleDiscoveryWake(event);
  if (result.status === "claimed") await triggerDiscoveryN8n(result.trigger);
  return { status: result.status, nextWakeAt: result.nextWakeAt };
}

export async function executeDiscoveryWake(raw: unknown, deps: {
  sleepUntil: (at: string) => Promise<unknown>;
  run: (event: DiscoveryWakeEventV1) => Promise<{ status: string; nextWakeAt: string | null }>;
  dispatchPending: () => Promise<unknown>;
  now?: () => number;
}) {
  const event = DiscoveryWakeEventSchema.parse(raw);
  if (Date.parse(event.runAt) - (deps.now?.() ?? Date.now()) > DAY_MS)
    throw new Error("DISCOVERY_WAKE_OUTSIDE_HORIZON");
  await deps.sleepUntil(event.runAt);
  const result = await deps.run(event);
  await deps.dispatchPending();
  return result;
}

export const DISCOVERY_INTERPRET_EVENT = "sales/discovery.interpret.v1" as const;
export const DiscoveryInterpretEventSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().uuid(),
  sourceKey: z.string().min(1).max(80),
  attemptToken: z.string().uuid(),
  attemptGeneration: z.number().int().positive(),
}).strict();

export type DiscoveryInterpretEventV1 = z.infer<typeof DiscoveryInterpretEventSchema>;

/** Schedule only. Never performs model I/O. Admission must not wait on inference. */
export async function scheduleDiscoveryInterpretation(
  event: Omit<DiscoveryInterpretEventV1, "schemaVersion">,
) {
  if (!isDiscoveryExecutionEnabled()) return { status: "execution_disabled" as const };
  if (!inngestCloudConfigured()) return { status: "scheduler_unavailable" as const };
  const data = DiscoveryInterpretEventSchema.parse({
    schemaVersion: 1,
    ...event,
  });
  try {
    const { ids } = await inngest.send({
      id: `discovery-interpret:${data.jobId}:${data.attemptToken}:${data.sourceKey}`,
      name: DISCOVERY_INTERPRET_EVENT,
      data,
    });
    return { status: ids[0] ? "dispatched" : "repair_needed" as const };
  } catch {
    return { status: "repair_needed" as const };
  }
}

export async function executeDiscoveryInterpret(
  raw: unknown,
  deps: {
    run: (
      event: DiscoveryInterpretEventV1,
    ) => Promise<{ status: string; remaining?: number }>;
    sendEvent?: (event: {
      id: string;
      name: typeof DISCOVERY_INTERPRET_EVENT;
      data: DiscoveryInterpretEventV1;
    }) => Promise<unknown>;
  },
) {
  const event = DiscoveryInterpretEventSchema.parse(raw);
  const result = await deps.run(event);
  if (
    deps.sendEvent &&
    (result.remaining ?? 0) > 0 &&
    (result.status === "pending" || result.status === "continuing")
  ) {
    await deps.sendEvent({
      id: `discovery-interpret:${event.jobId}:${event.attemptToken}:${event.sourceKey}:${result.status}:${result.remaining}`,
      name: DISCOVERY_INTERPRET_EVENT,
      data: event,
    });
  }
  return result;
}

/** Repair-only schedule. Never performs model I/O. */
export async function dispatchPendingDiscoveryInterpretationJobs() {
  if (!isDiscoveryExecutionEnabled()) {
    return { status: "execution_disabled", results: [] };
  }
  const pending = await listPendingDiscoveryInterpretationJobs({ limit: 25 });
  const results: Array<{ jobId: string; sourceKey: string; status: string }> =
    [];
  for (const event of pending) {
    const result = await scheduleDiscoveryInterpretation(event);
    results.push({
      jobId: event.jobId,
      sourceKey: event.sourceKey,
      status: result.status,
    });
  }
  return {
    status: pending.length ? "pending" : "idle",
    results,
  };
}
