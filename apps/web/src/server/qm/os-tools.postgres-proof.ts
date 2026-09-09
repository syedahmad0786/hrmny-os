import { randomUUID } from "node:crypto";
import { employee, eq, sql } from "@hrmny/db";
import { expect, it, vi } from "vitest";
import { POST } from "../../app/api/qm/os/route";
import { getDb } from "../db";
import { setFeatureOverride } from "../features";

it("uses real current staff and Work membership to exclude another employee's private project and task", async () => {
  const db = getDb()!;
  const owner = randomUUID(),
    other = randomUUID();
  const visible = randomUUID(),
    hidden = randomUUID(),
    item = randomUUID();
  const actorId = `qm-ci-${owner}@hrmny.co`;
  await db.insert(employee).values([
    { employeeId: owner, email: actorId, displayName: "QM OS CI owner" },
    {
      employeeId: other,
      email: `qm-ci-${other}@hrmny.co`,
      displayName: "QM OS CI other",
    },
  ]);
  for (const featureKey of ["work.projects", "work.tasks"]) {
    await setFeatureOverride({
      featureKey,
      scopeType: "global",
      scopeKey: "global",
      enabled: true,
      updatedByEmployeeId: owner,
    });
  }
  for (const [project, actor] of [
    [visible, owner],
    [hidden, other],
  ]) {
    await db.execute(sql`
      insert into public.work_project (work_project_id, name, privacy, owner_employee_id, created_by_employee_id)
      values (${project}::uuid, ${`CI private ${project}`}, 'private', ${actor}::uuid, ${actor}::uuid)
    `);
  }
  await db.execute(sql`
    insert into public.work_item (work_item_id, title, created_by_employee_id)
    values (${item}::uuid, 'CI private other task', ${other}::uuid)
  `);
  await db.execute(sql`
    insert into public.work_project_item (work_project_id, work_item_id)
    values (${hidden}::uuid, ${item}::uuid)
  `);
  const nativeFetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://hrmny-portal.fly.dev/v1/apis");
      expect(init?.headers).toEqual({
        "x-agent-capability": "synthetic.ci.token",
      });
      return Response.json({ actorId, scopeId: `personal:${actorId}` });
    },
  );
  vi.stubGlobal("fetch", nativeFetch);
  vi.stubEnv("QM_PUBLIC_URL", "https://hrmny-portal.fly.dev");
  vi.stubEnv("QM_OS_TOOLS_ENABLED", "1");
  const call = (input: unknown) =>
    POST(
      new Request("https://os.example/api/qm/os", {
        method: "POST",
        headers: { "x-agent-capability": "synthetic.ci.token" },
        body: JSON.stringify(input),
      }),
    );
  try {
    const list = await call({ operation: "list_projects" });
    expect(list.status).toBe(200);
    const projects = (await list.json()) as { projectId: string }[];
    expect(projects.some((project) => project.projectId === visible)).toBe(
      true,
    );
    expect(projects.some((project) => project.projectId === hidden)).toBe(
      false,
    );
    expect(
      (await call({ operation: "get_project", projectId: visible })).status,
    ).toBe(200);
    expect(
      (await call({ operation: "get_project", projectId: hidden })).status,
    ).toBe(403);
    expect((await call({ operation: "get_task", itemId: item })).status).toBe(
      403,
    );
    await db.execute(sql`
      insert into public.work_project_member (work_project_id, employee_id, access_level)
      values (${hidden}::uuid, ${owner}::uuid, 'viewer')
    `);
    expect((await call({ operation: "get_task", itemId: item })).status).toBe(
      200,
    );
    await db.execute(sql`
      delete from public.work_project_member where work_project_id = ${hidden}::uuid and employee_id = ${owner}::uuid
    `);
    expect((await call({ operation: "get_task", itemId: item })).status).toBe(
      403,
    );
    await setFeatureOverride({
      featureKey: "work.projects",
      scopeType: "user",
      scopeKey: owner,
      enabled: false,
      updatedByEmployeeId: owner,
    });
    expect(
      (await call({ operation: "get_project", projectId: visible })).status,
    ).toBe(403);
    await db
      .update(employee)
      .set({ isActive: false })
      .where(eq(employee.employeeId, owner));
    expect((await call({ operation: "list_projects" })).status).toBe(403);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
