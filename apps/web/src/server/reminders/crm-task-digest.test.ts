import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCrmTaskDigest,
  resetCrmTaskDigestMemory,
  runCrmTaskDigest,
} from "./crm-task-digest";
import { resetCrmMemory } from "../crm/memory";
import { createCrmTask } from "../crm/repository";
import type { CrmTaskRow } from "../crm/types";

const TODAY = "2026-08-04";
const OWNER_A = "c0000000-0000-4000-8000-0000000000aa";
const OWNER_B = "c0000000-0000-4000-8000-0000000000bb";

function task(partial: Partial<CrmTaskRow>): CrmTaskRow {
  return {
    crmTaskId: crypto.randomUUID(),
    title: "t",
    status: "open",
    dueDate: null,
    companyId: null,
    contactId: null,
    dealId: null,
    ownerEmployeeId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("buildCrmTaskDigest", () => {
  it("selects open/in_progress due today or overdue and groups by owner", () => {
    const digest = buildCrmTaskDigest(
      [
        task({ title: "a-over", dueDate: "2026-08-01", ownerEmployeeId: OWNER_A }),
        task({
          title: "a-today",
          dueDate: TODAY,
          ownerEmployeeId: OWNER_A,
          status: "in_progress",
        }),
        task({ title: "b-today", dueDate: TODAY, ownerEmployeeId: OWNER_B }),
        task({ title: "unowned-over", dueDate: "2026-07-30" }),
        // excluded: future, done, cancelled, no due date
        task({ title: "future", dueDate: "2026-08-05", ownerEmployeeId: OWNER_A }),
        task({ title: "done", dueDate: "2026-08-01", status: "done" }),
        task({ title: "cancelled", dueDate: "2026-08-01", status: "cancelled" }),
        task({ title: "no-due", ownerEmployeeId: OWNER_B }),
      ],
      TODAY,
    );
    expect(digest.totalOverdue).toBe(2);
    expect(digest.totalDueToday).toBe(2);
    expect(digest.groups).toHaveLength(3);
    const groupA = digest.groups.find((g) => g.ownerEmployeeId === OWNER_A)!;
    expect(groupA.overdue.map((t) => t.title)).toEqual(["a-over"]);
    expect(groupA.dueToday.map((t) => t.title)).toEqual(["a-today"]);
    const groupB = digest.groups.find((g) => g.ownerEmployeeId === OWNER_B)!;
    expect(groupB.overdue).toHaveLength(0);
    expect(groupB.dueToday.map((t) => t.title)).toEqual(["b-today"]);
    const unowned = digest.groups.find((g) => g.ownerEmployeeId === null)!;
    expect(unowned.overdue.map((t) => t.title)).toEqual(["unowned-over"]);
  });

  it("returns no groups when nothing is due", () => {
    const digest = buildCrmTaskDigest(
      [task({ title: "future", dueDate: "2026-12-31" })],
      TODAY,
    );
    expect(digest.groups).toHaveLength(0);
  });
});

describe("runCrmTaskDigest", () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    resetCrmMemory();
    resetCrmTaskDigestMemory();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("no-ops with a logged skip when the webhook env is unset", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "");
    const result = await runCrmTaskDigest(new Date(`${TODAY}T05:00:00Z`));
    expect(result).toEqual({ posted: false, skipped: "no_webhook" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one grouped digest, then dedupes for the rest of the day", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "https://chat.googleapis.com/fake");
    await createCrmTask({
      title: "Chase overdue proposal",
      dueDate: "2026-08-01",
      ownerEmployeeId: OWNER_A,
    });
    await createCrmTask({
      title: "Call due today",
      dueDate: TODAY,
      ownerEmployeeId: OWNER_B,
    });

    const now = new Date(`${TODAY}T05:00:00Z`);
    const first = await runCrmTaskDigest(now);
    expect(first).toEqual({ posted: true, owners: 2, overdue: 1, dueToday: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0]![1]!.body);
    expect(body).toContain("crm_task_digest");
    expect(body).toContain("Chase overdue proposal");
    expect(body).toContain("Call due today");
    expect(body).toContain(OWNER_A);

    // second tick same day: idempotent
    const second = await runCrmTaskDigest(new Date(`${TODAY}T06:00:00Z`));
    expect(second).toEqual({ posted: false, skipped: "already_sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for the morning window before posting", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "https://chat.googleapis.com/fake");
    const result = await runCrmTaskDigest(new Date(`${TODAY}T02:00:00Z`));
    expect(result).toEqual({ posted: false, skipped: "before_window" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips posting when no tasks are due", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "https://chat.googleapis.com/fake");
    // seeded memory tasks are all future-dated relative to the real clock,
    // so an injected "today" far in the past sees nothing due
    const result = await runCrmTaskDigest(new Date("2020-01-01T05:00:00Z"));
    expect(result).toEqual({ posted: false, skipped: "nothing_due" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
