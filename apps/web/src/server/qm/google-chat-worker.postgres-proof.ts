import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createDb, employee, scheduledJob, sql } from "@hrmny/db";
import { beforeAll, expect, it, vi } from "vitest";
import { withDatabaseScope } from "../db";
import {
  recordIntegrationReceipt,
  getIntegrationReceipt,
} from "../integrations/inbox";
import {
  GOOGLE_CHAT_QM_JOB_KIND,
  googleChatReplyMessageId,
  runGoogleChatInteractionJob,
} from "../google-chat";
import { operateQmGoogleChat } from "./google-chat-worker";

const mocks = vi.hoisted(() => ({
  staff: new Map<string, { email: string; active: boolean }>(),
  createCaller: vi.fn(() => {
    throw new Error("MODEL_MUST_NOT_RUN_FOR_QM_REPLY");
  }),
}));
vi.mock("../trpc/root", () => ({ createCaller: mocks.createCaller }));
vi.mock("../auth/session", async (original) => ({
  ...(await original<typeof import("../auth/session")>()),
  resolveActiveStaffById: vi.fn(async (employeeId: string) => {
    const entry = mocks.staff.get(employeeId);
    return entry?.active
      ? {
          employeeId,
          email: entry.email,
          displayName: "Synthetic worker user",
          roles: [],
          permissions: [],
          actorType: "staff",
          clientId: null,
        }
      : null;
  }),
}));
const databaseUrl = process.env.DATABASE_URL ?? "";
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("LOCAL_POSTGRES_PROOF_REQUIRED");
const dbA = createDb(databaseUrl),
  dbB = createDb(databaseUrl);
const employeeA = randomUUID(),
  employeeB = randomUUID();
beforeAll(async () => {
  await dbA.insert(employee).values([
    {
      employeeId: employeeA,
      displayName: "QM Chat CI A",
      email: `qm-chat-a-${employeeA}@hrmny.invalid`,
    },
    {
      employeeId: employeeB,
      displayName: "QM Chat CI B",
      email: `qm-chat-b-${employeeB}@hrmny.invalid`,
    },
  ]);
  mocks.staff.set(employeeA, { email: "synthetic-a@hrmny.co", active: true });
  mocks.staff.set(employeeB, { email: "synthetic-b@hrmny.co", active: true });
});

async function enqueue(employeeId: string) {
  const externalEventId = `spaces/QmSynthetic/messages/${randomUUID()}`;
  const receipt = await withDatabaseScope(dbA, () =>
    recordIntegrationReceipt({
      provider: "google-chat",
      externalEventId,
      operation: "MESSAGE",
      rawBody: externalEventId,
      status: "processing",
      ownerEmployeeId: employeeId,
    }),
  );
  const payload = {
    receiptId: receipt.receiptId,
    externalEventId,
    employeeId,
    googleUserName: employeeId === employeeA ? "users/111" : "users/222",
    spaceName: "spaces/QmSynthetic",
    threadName: "spaces/QmSynthetic/threads/shared",
    prompt: "Synthetic native Chat canary",
    appOrigin: "https://hrmny-os.vercel.app",
    externalRef: "google-chat:spaces/QmSynthetic:shared",
    title: "Synthetic Chat",
  };
  const [job] = await dbA
    .insert(scheduledJob)
    .values({
      jobKey: `google-chat:${receipt.receiptId}`,
      kind: GOOGLE_CHAT_QM_JOB_KIND,
      payload,
      integrationInboxId: receipt.receiptId,
      runAt: new Date(),
    })
    .returning({ jobId: scheduledJob.scheduledJobId });
  return { payload, jobId: job!.jobId };
}
const operate = (body: unknown, db = dbA) =>
  withDatabaseScope(db, () => operateQmGoogleChat(body));

it("claims concurrently, fences old workers, blocks revocation, and delivers a saved QM reply once", async () => {
  process.env.GOOGLE_CHAT_RUNTIME = "qm";
  process.env.QM_GOOGLE_CHAT_EMPLOYEE_IDS = `${employeeA},${employeeB}`;
  const a = await enqueue(employeeA),
    b = await enqueue(employeeB);
  const claimed = await Promise.all([
    operate({ action: "claim" }),
    operate({ action: "claim" }, dbB),
  ]);
  const jobs = claimed.map((value) => ("job" in value ? value.job : null));
  expect(jobs.every(Boolean)).toBe(true);
  const first = jobs.find((job) => job?.jobId === a.jobId)!;
  const second = jobs.find((job) => job?.jobId === b.jobId)!;
  expect(first.threadRef).not.toBe(second.threadRef);
  expect(
    first.threadRef.startsWith(
      `web:${first.actorId}:google-chat-${employeeA}-`,
    ),
  ).toBe(true);
  expect(
    second.threadRef.startsWith(
      `web:${second.actorId}:google-chat-${employeeB}-`,
    ),
  ).toBe(true);
  expect(first.threadRef.startsWith(`web:${second.actorId}:`)).toBe(false);
  expect(new Set(jobs.map((job) => job!.jobId)).size).toBe(2);
  await expect(
    operate({ action: "renew", jobId: first.jobId, claimToken: randomUUID() }),
  ).rejects.toThrow("LEASE_LOST");
  mocks.staff.get(employeeA)!.active = false;
  await expect(
    operate({
      action: "renew",
      jobId: first.jobId,
      claimToken: first.claimToken,
    }),
  ).rejects.toThrow("STAFF_REVOKED");
  const revoked = await withDatabaseScope(dbA, () =>
    getIntegrationReceipt("google-chat", a.payload.externalEventId),
  );
  expect(revoked?.status).toBe("failed");
  const runId = randomUUID(),
    sessionId = randomUUID();
  const lease = { jobId: second.jobId, claimToken: second.claimToken, runId };
  await operate({ action: "renew", ...lease });
  await expect(
    operate({ action: "renew", ...lease, runId: randomUUID() }),
  ).rejects.toThrow("RUN_CHANGED");
  await operate({
    action: "complete",
    ...lease,
    result: { status: "ok", reply: "SYNTHETIC_QM_CHAT_OK", sessionId },
  });
  const ready = await withDatabaseScope(dbA, () =>
    getIntegrationReceipt("google-chat", b.payload.externalEventId),
  );
  expect(ready?.result).toMatchObject({
    bridgeStatus: "reply_ready",
    qmSessionId: sessionId,
    qmRunId: runId,
  });
  await expect(
    operate({
      action: "complete",
      ...lease,
      result: { status: "ok", reply: "changed" },
    }),
  ).rejects.toThrow("LEASE_LOST");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "synthetic@hrmny.invalid",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  const message = {
    name: "spaces/QmSynthetic/messages/native.reply",
    text: ready!.result!.text,
    clientAssignedMessageId: googleChatReplyMessageId(b.payload.receiptId),
    privateMessageViewer: { name: "users/222" },
    thread: { name: b.payload.threadName },
  };
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url) === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "synthetic-access" });
    if (
      !String(url).startsWith(
        "https://chat.googleapis.com/v1/spaces/QmSynthetic/messages",
      )
    )
      throw new Error("UNEXPECTED_PROVIDER_REQUEST");
    if (options?.method === "POST")
      expect(JSON.parse(String(options.body))).toMatchObject({
        text: message.text,
        privateMessageViewer: { name: "users/222" },
        thread: { name: b.payload.threadName },
      });
    return Response.json(message);
  });
  vi.stubGlobal("fetch", fetcher);
  const delivered = await withDatabaseScope(dbA, () =>
    runGoogleChatInteractionJob(b.payload),
  );
  expect(delivered.replay).toBe(false);
  expect(
    (await withDatabaseScope(dbA, () => runGoogleChatInteractionJob(b.payload)))
      .replay,
  ).toBe(true);
  expect(mocks.createCaller).not.toHaveBeenCalled();
  expect(
    fetcher.mock.calls.filter(
      ([url, options]) =>
        String(url).includes("/messages?") && options?.method === "POST",
    ),
  ).toHaveLength(1);
  const completed = await withDatabaseScope(dbA, () =>
    getIntegrationReceipt("google-chat", b.payload.externalEventId),
  );
  expect(completed?.result).toMatchObject({
    qmSessionId: sessionId,
    qmRunId: runId,
    qmThreadRef: second.threadRef,
  });

  const c = await enqueue(employeeB);
  const claimedC = await operate({ action: "claim" });
  const old = "job" in claimedC ? claimedC.job! : null!;
  await operate({
    action: "renew",
    jobId: old.jobId,
    claimToken: old.claimToken,
    runId,
  });
  await dbA.execute(
    sql`update public.scheduled_job set locked_at = now() - interval '3 minutes' where scheduled_job_id = ${c.jobId}::uuid`,
  );
  const reclaimed = await operate({ action: "claim" }, dbB);
  const current = "job" in reclaimed ? reclaimed.job! : null!;
  expect(current.runId).toBe(runId);
  expect(current.threadRef).toBe(second.threadRef);
  expect(current.claimToken).not.toBe(old.claimToken);
  await expect(
    operate({ action: "renew", jobId: old.jobId, claimToken: old.claimToken }),
  ).rejects.toThrow("LEASE_LOST");
  await dbA.execute(
    sql`update public.scheduled_job set attempts = 3, locked_at = now() - interval '3 minutes' where scheduled_job_id = ${c.jobId}::uuid`,
  );
  await operate({ action: "claim" });
  expect(
    (
      await withDatabaseScope(dbA, () =>
        getIntegrationReceipt("google-chat", c.payload.externalEventId),
      )
    )?.status,
  ).toBe("failed");
});
