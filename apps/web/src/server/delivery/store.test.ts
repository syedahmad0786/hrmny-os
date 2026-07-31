import { afterEach, describe, expect, it, vi } from "vitest";

describe("delivery store memory fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("upserts and lists tasks from demo memory when DATABASE_URL unset", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_MODE", "dev");
    const { upsertTask, listTasks, getTask } = await import("./store");
    // Ensure demo store is fresh for this module instance.
    const { getDemoStore } = await import("../demo-store");
    getDemoStore().tasks.clear();

    const task = await upsertTask({
      taskId: "b1000000-0000-4000-8000-000000000099",
      clientId: "c1000000-0000-4000-8000-0000000000a4",
      calendarId: null,
      month: "2026-07",
      taskType: "creative",
      title: "Test delivery task",
      status: "backlog",
      situationalState: null,
      ownerEmployeeId: null,
      deadline: null,
      priority: "high",
      qcPassed: false,
      qcNotes: null,
      clientRevisionCount: 0,
      revisionBoundaryAck: false,
      briefId: null,
    });
    expect(task.title).toBe("Test delivery task");
    expect(await getTask(task.taskId)).toMatchObject({
      title: "Test delivery task",
      status: "backlog",
    });
    const listed = await listTasks({
      clientId: "c1000000-0000-4000-8000-0000000000a4",
    });
    expect(listed.some((t) => t.taskId === task.taskId)).toBe(true);
  }, 10_000);
});
