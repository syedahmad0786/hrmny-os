import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/qm/projects/route";
import { MAX_QM_WORK_PROJECTS, MAX_QM_WORK_STAFF } from "./work-projects";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withDatabaseScope: vi.fn((_db: unknown, work: () => Promise<unknown>) =>
    work(),
  ),
  resolveStaff: vi.fn(),
  overrides: vi.fn(),
  projectAccess: vi.fn(),
  viewOnly: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: mocks.getDb,
  withDatabaseScope: mocks.withDatabaseScope,
}));
vi.mock("../auth/session", () => ({
  resolveActiveStaffByEmails: mocks.resolveStaff,
}));
vi.mock("../features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features")>()),
  listFeatureOverrides: mocks.overrides,
}));
vi.mock("../trpc/work-management-router", () => ({
  readProjectAccessForEmployees: mocks.projectAccess,
}));
vi.mock("../work-governance", () => ({
  listWorkViewOnlyMemberIds: mocks.viewOnly,
}));

const token = "synthetic-qm-work-authority-token-1234567890";
const ids = {
  projectA: "a0000000-0000-4000-8000-000000000001",
  projectB: "a0000000-0000-4000-8000-000000000002",
  projectC: "a0000000-0000-4000-8000-000000000003",
  disabledClient: "c0000000-0000-4000-8000-000000000001",
  direct: "b0000000-0000-4000-8000-000000000001",
  team: "b0000000-0000-4000-8000-000000000002",
  org: "b0000000-0000-4000-8000-000000000003",
  owner: "b0000000-0000-4000-8000-000000000004",
  revoked: "b0000000-0000-4000-8000-000000000005",
  inactive: "b0000000-0000-4000-8000-000000000006",
};

const staff = [
  person(ids.direct, "direct@hrmny.co"),
  person(ids.team, "team@hrmny.co"),
  person(ids.org, "org@hrmny.co"),
  person(ids.owner, "owner@hrmny.co"),
  person(ids.revoked, "revoked@hrmny.co", ["revoked"]),
];

function person(employeeId: string, email: string, roles: string[] = []) {
  return {
    employeeId,
    email,
    displayName: email,
    roles,
    permissions: [],
    actorType: "staff" as const,
    clientId: null,
  };
}

function project(
  projectId: string,
  name: string,
  ownerEmail: string | null,
  clientId: string | null = null,
) {
  return {
    projectId,
    name,
    clientId,
    ownerEmail,
    createdAt: "2026-09-10T08:00:00.000Z",
    updatedAt: "2026-09-10T09:00:00.000Z",
  };
}

function access(
  actorEmployeeId: string,
  projectId: string,
  accessLevel: "admin" | "editor" | "commenter" | "viewer",
) {
  return { actorEmployeeId, projectId, accessLevel };
}

function request(body: unknown, credential = token): Request {
  return new Request("https://hrmny.example/api/qm/projects", {
    method: "POST",
    headers: { authorization: `Bearer ${credential}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function database(
  candidates: unknown[],
  activeEmails = [
    ...staff.map((member) => ({ email: member.email })),
    { email: "inactive@hrmny.co" },
  ],
  revision: string | null = "42",
) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(revision === null ? [] : [{ revision }])
    .mockResolvedValueOnce(candidates)
    .mockResolvedValueOnce(activeEmails);
  const tx = { execute };
  const db = {
    transaction: vi.fn((work: (transaction: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  mocks.getDb.mockReturnValue(db);
  return { db, tx };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.withDatabaseScope.mockImplementation(
    (_db: unknown, work: () => Promise<unknown>) => work(),
  );
  vi.stubEnv("QM_WORK_PROJECTS_ENABLED", "1");
  vi.stubEnv("QM_WORK_AUTHORITY_TOKEN", token);
  mocks.resolveStaff.mockResolvedValue(staff);
  mocks.overrides.mockResolvedValue([
    {
      featureOverrideId: "override",
      featureKey: "work.projects",
      scopeType: "role",
      scopeKey: "revoked",
      enabled: false,
      reason: null,
      updatedByEmployeeId: null,
      updatedAt: "2026-09-10T00:00:00.000Z",
    },
    {
      featureOverrideId: "client-override",
      featureKey: "work.projects",
      scopeType: "client",
      scopeKey: ids.disabledClient,
      enabled: false,
      reason: null,
      updatedByEmployeeId: null,
      updatedAt: "2026-09-10T00:00:00.000Z",
    },
  ]);
  mocks.viewOnly.mockResolvedValue(new Set([ids.owner]));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("returns one coherent revision and complete canonical rosters for direct, team, and organization access", async () => {
  const { tx } = database([
    project(ids.projectA, "Ownerless", null),
    project(ids.projectB, "Inactive owner", "Former.Owner@HRMNY.CO"),
    project(ids.projectC, "Disabled client", null, ids.disabledClient),
  ]);
  mocks.projectAccess
    .mockResolvedValueOnce([
      access(ids.direct, ids.projectA, "editor"),
      access(ids.direct, ids.projectB, "editor"),
      access(ids.direct, ids.projectC, "editor"),
    ])
    .mockResolvedValueOnce([
      access(ids.direct, ids.projectA, "editor"),
      access(ids.team, ids.projectA, "commenter"),
      access(ids.org, ids.projectA, "viewer"),
      access(ids.owner, ids.projectA, "admin"),
      access(ids.revoked, ids.projectA, "admin"),
      access(ids.direct, ids.projectB, "editor"),
    ]);

  const response = await POST(
    request({ operation: "list", principalId: "direct@hrmny.co" }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    revision: "42",
    projects: [
      {
        id: ids.projectA,
        name: "Ownerless",
        ownerId: null,
        memberIds: [
          "direct@hrmny.co",
          "org@hrmny.co",
          "owner@hrmny.co",
          "team@hrmny.co",
        ],
        permissions: {
          "direct@hrmny.co": "write",
          "org@hrmny.co": "read",
          "owner@hrmny.co": "read",
          "team@hrmny.co": "read",
        },
        createdAt: Date.parse("2026-09-10T08:00:00.000Z"),
        updatedAt: Date.parse("2026-09-10T09:00:00.000Z"),
        authorityVersion: "42",
      },
      {
        id: ids.projectB,
        name: "Inactive owner",
        ownerId: "former.owner@hrmny.co",
        memberIds: ["direct@hrmny.co"],
        permissions: { "direct@hrmny.co": "write" },
        createdAt: Date.parse("2026-09-10T08:00:00.000Z"),
        updatedAt: Date.parse("2026-09-10T09:00:00.000Z"),
        authorityVersion: "42",
      },
    ],
  });
  expect(mocks.projectAccess).toHaveBeenNthCalledWith(
    1,
    [ids.direct],
    [ids.projectA, ids.projectB, ids.projectC],
  );
  expect(mocks.projectAccess).toHaveBeenNthCalledWith(
    2,
    staff.map((member) => member.employeeId),
    [ids.projectA, ids.projectB],
  );
  expect(mocks.resolveStaff).toHaveBeenCalledWith([
    ...staff.map((member) => member.email),
    "inactive@hrmny.co",
  ]);
  expect(mocks.projectAccess.mock.calls.flat().join(",")).not.toContain(
    ids.inactive,
  );
  expect(mocks.withDatabaseScope).toHaveBeenCalledWith(
    tx,
    expect.any(Function),
  );
});

it("rejects disabled, unauthenticated, non-canonical, and non-strict requests before opening the database", async () => {
  vi.stubEnv("QM_WORK_PROJECTS_ENABLED", "0");
  expect(
    (await POST(request({ operation: "project", projectId: ids.projectA })))
      .status,
  ).toBe(403);
  vi.stubEnv("QM_WORK_PROJECTS_ENABLED", "1");
  vi.stubEnv("QM_WORK_AUTHORITY_TOKEN", "too-short");
  expect(
    (await POST(request({ operation: "project", projectId: ids.projectA })))
      .status,
  ).toBe(403);
  vi.stubEnv("QM_WORK_AUTHORITY_TOKEN", token);
  for (const candidate of [
    request({ operation: "project", projectId: ids.projectA }, "wrong"),
    request({ operation: "list", principalId: "Direct@hrmny.co" }),
    request({ operation: "list", principalId: "direct@example.com" }),
    request({ operation: "project", projectId: ids.projectA, extra: true }),
    request({ operation: "other", projectId: ids.projectA }),
  ])
    expect((await POST(candidate)).status).toBeLessThan(500);
  expect(mocks.getDb).not.toHaveBeenCalled();
});

it("caps the streamed request body and returns only safe infrastructure errors", async () => {
  const oversized = request("x".repeat(1_025));
  expect((await POST(oversized)).status).toBe(413);
  mocks.getDb.mockReturnValue(null);
  const response = await POST(
    request({ operation: "project", projectId: ids.projectA }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "QM_WORK_PROJECTS_UNAVAILABLE",
  });

  database([], [], null);
  const missingRevision = await POST(
    request({ operation: "project", projectId: ids.projectA }),
  );
  expect(missingRevision.status).toBe(503);
  expect(await missingRevision.json()).toEqual({
    error: "QM_WORK_PROJECTS_UNAVAILABLE",
  });
});

it("fails closed on staff, project, and canonical identity ceilings", async () => {
  const tooManyProjects = Array.from(
    { length: MAX_QM_WORK_PROJECTS + 1 },
    (_, index) => project(crypto.randomUUID(), `Project ${index}`, null),
  );
  database(tooManyProjects);
  expect(
    (await POST(request({ operation: "list", principalId: "direct@hrmny.co" })))
      .status,
  ).toBe(503);
  expect(mocks.projectAccess).not.toHaveBeenCalled();

  database(
    [project(ids.projectA, "Project", null)],
    Array.from({ length: MAX_QM_WORK_STAFF + 1 }, (_, index) => ({
      email: `staff-${index}@hrmny.co`,
    })),
  );
  expect(
    (await POST(request({ operation: "project", projectId: ids.projectA })))
      .status,
  ).toBe(503);

  database([project(ids.projectA, "Project", null)]);
  mocks.resolveStaff.mockResolvedValueOnce([
    person(ids.direct, "collision@hrmny.co"),
    person(ids.team, "COLLISION@HRMNY.CO"),
  ]);
  expect(
    (await POST(request({ operation: "project", projectId: ids.projectA })))
      .status,
  ).toBe(503);
});

it("returns an empty project result when the standard active project or permitted roster is absent", async () => {
  database([]);
  const missing = await POST(
    request({ operation: "project", projectId: ids.projectA }),
  );
  expect(await missing.json()).toEqual({ revision: "42", projects: [] });

  database([project(ids.projectA, "Private", null)]);
  mocks.projectAccess.mockResolvedValueOnce([]);
  const denied = await POST(
    request({ operation: "list", principalId: "direct@hrmny.co" }),
  );
  expect(await denied.json()).toEqual({ revision: "42", projects: [] });
});
