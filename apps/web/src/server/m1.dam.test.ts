import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore } from "@hrmny/integrations";
import { getDemoStore } from "./demo-store";
import {
  DEV_USERS,
  resolveDevUser,
  sessionCanViewMargin,
} from "./auth/session";
import { createCaller, selectAssetProjectScopes } from "./trpc/root";
import { getDemoWork } from "./trpc/work-management-router";
import { clearDemoWorkGovernance, setDemoWorkLicense } from "./work-governance";

const CLIENT_ID = "b1000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b2000000-0000-4000-8000-000000000001";
const ITEM_ID = "b3000000-0000-4000-8000-000000000001";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function callerFor(role: "partner" | "am" | "creative_director" | "portal_a") {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

function seedPrivateClientWork() {
  const work = getDemoWork();
  const baseProject = [...work.projects.values()][0]!;
  const baseItem = [...work.items.values()][0]!;
  work.projects.set(PROJECT_ID, {
    ...baseProject,
    projectId: PROJECT_ID,
    name: "Private client delivery",
    privacy: "private",
    projectKind: "personal",
    clientId: CLIENT_ID,
    ownerEmployeeId: DEV_USERS.partner!.employeeId,
    accessLevel: "admin",
  });
  work.items.set(ITEM_ID, {
    ...baseItem,
    itemId: ITEM_ID,
    projectId: PROJECT_ID,
    title: "Private client creative",
  });
}

async function createOrganizationAsset(title: string) {
  const caller = callerFor("partner");
  const project = (await caller.work.projects.list()).find(
    (candidate) => candidate.privacy === "organization",
  )!;
  const detail = await caller.work.projects.get({
    projectId: project.projectId,
  });
  return caller.assets.create({ title, workItemId: detail.items[0]!.itemId });
}

describe("M1 Work Files DAM acceptance", () => {
  beforeEach(() => {
    const store = getDemoStore();
    store.assets.clear();
    store.audits = [];
    store.healthSignals = [];
    store.objectStore = createMemoryObjectStore();
    clearDemoWorkGovernance();
    seedPrivateClientWork();
  });

  afterEach(() => {
    const work = getDemoWork();
    work.projects.delete(PROJECT_ID);
    work.items.delete(ITEM_ID);
    getDemoStore().objectStore = createMemoryObjectStore();
    clearDemoWorkGovernance();
  });

  it("requires an explicit project or matching client scope for multi-client work items", () => {
    const scopes = [
      { projectId: PROJECT_ID, clientId: CLIENT_ID },
      {
        projectId: "b2000000-0000-4000-8000-000000000002",
        clientId: "b1000000-0000-4000-8000-000000000002",
      },
    ];
    expect(() =>
      selectAssetProjectScopes(scopes, { requireSingleClient: true }),
    ).toThrow("Select a project");
    expect(selectAssetProjectScopes(scopes, { projectId: PROJECT_ID })).toEqual(
      [scopes[0]],
    );
    expect(
      selectAssetProjectScopes(scopes, {
        clientScope: { clientId: CLIENT_ID },
      }),
    ).toEqual([scopes[0]]);
  });

  it("derives client ownership from Work and denies other staff and portal users", async () => {
    const partner = callerFor("partner");
    const asset = await partner.assets.create({
      title: "Client-owned artwork",
      workItemId: ITEM_ID,
    });
    const version = await partner.assets.uploadVersion({
      assetId: asset.assetId,
      fileName: "private.png",
      contentType: "image/png",
      contentBase64: PNG,
    });
    expect(asset.clientId).toBe(CLIENT_ID);
    expect(await partner.assets.list({ workItemId: ITEM_ID })).toHaveLength(1);

    const am = callerFor("am");
    await expect(am.assets.list({ workItemId: ITEM_ID })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
    await expect(am.assets.get({ id: asset.assetId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      am.assets.signedUrl({
        assetId: asset.assetId,
        versionId: version.assetVersionId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      callerFor("portal_a").assets.get({ id: asset.assetId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects malformed, mismatched, unsupported and oversized uploads and sanitizes filenames", async () => {
    const partner = callerFor("partner");
    const asset = await partner.assets.create({
      title: "Validated artwork",
      workItemId: ITEM_ID,
    });
    const upload = (overrides: Record<string, unknown>) =>
      partner.assets.uploadVersion({
        assetId: asset.assetId,
        fileName: "art.png",
        contentType: "image/png",
        contentBase64: PNG,
        ...overrides,
      } as Parameters<typeof partner.assets.uploadVersion>[0]);

    await expect(upload({ contentBase64: "%%%" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      upload({ contentBase64: Buffer.from("not png").toString("base64") }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(upload({ contentType: "text/plain" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      upload({ contentBase64: Buffer.alloc(10_000_001).toString("base64") }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(upload({ fileName: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const safe = await upload({ fileName: "../unsafe name.png" });
    expect(safe.storagePath).not.toContain("/../");
    expect(safe.storagePath).not.toContain("unsafe name");
  });

  it("allocates immutable versions under concurrent upload and signs each for five minutes", async () => {
    const partner = callerFor("partner");
    const asset = await partner.assets.create({
      title: "Versioned artwork",
      workItemId: ITEM_ID,
    });
    const versions = await Promise.all(
      ["first.png", "second.png"].map((fileName) =>
        partner.assets.uploadVersion({
          assetId: asset.assetId,
          fileName,
          contentType: "image/png",
          contentBase64: PNG,
        }),
      ),
    );
    const first = versions[0]!;
    const second = versions[1]!;
    expect([first.versionNumber, second.versionNumber].sort()).toEqual([1, 2]);
    expect(first.storagePath).not.toBe(second.storagePath);

    const before = structuredClone(first);
    await partner.assets.uploadVersion({
      assetId: asset.assetId,
      fileName: "third.png",
      contentType: "image/png",
      contentBase64: PNG,
    });
    const stored = await partner.assets.get({ id: asset.assetId });
    expect(stored?.versions).toHaveLength(3);
    expect(
      stored?.versions.find(
        (row) => row.assetVersionId === first.assetVersionId,
      ),
    ).toEqual(before);

    for (const version of [first, second]) {
      const startedAt = Date.now();
      const signed = await partner.assets.signedUrl({
        assetId: asset.assetId,
        versionId: version.assetVersionId,
      });
      expect(signed?.url).toContain("memory://dam/");
      expect(
        new Date(signed!.expiresAt).getTime() - startedAt,
      ).toBeGreaterThanOrEqual(299_000);
      expect(
        new Date(signed!.expiresAt).getTime() - startedAt,
      ).toBeLessThanOrEqual(301_000);
    }
  });

  it("resets QC approval when a new version is uploaded", async () => {
    const partner = callerFor("partner");
    const asset = await createOrganizationAsset("Revision approval");
    const first = await partner.assets.uploadVersion({
      assetId: asset.assetId,
      fileName: "approved.png",
      contentType: "image/png",
      contentBase64: PNG,
    });
    await partner.assets.qc({ id: asset.assetId, decision: "pass" });
    expect(await partner.assets.get({ id: asset.assetId })).toMatchObject({
      status: "qc_passed",
      approvedVersionId: first.assetVersionId,
    });

    await partner.assets.uploadVersion({
      assetId: asset.assetId,
      fileName: "revision.png",
      contentType: "image/png",
      contentBase64: PNG,
    });
    expect(await partner.assets.get({ id: asset.assetId })).toMatchObject({
      status: "draft",
      qcPassed: false,
      approvedVersionId: null,
      versions: [{ versionNumber: 1 }, { versionNumber: 2 }],
    });
  });

  it("denies asset mutations to Work view-only members", async () => {
    const partner = callerFor("partner");
    const project = (await partner.work.projects.list())[0]!;
    const detail = await partner.work.projects.get({
      projectId: project.projectId,
    });
    setDemoWorkLicense(DEV_USERS.partner!.employeeId, "view_only");
    await expect(
      partner.assets.create({
        title: "Forbidden view-only asset",
        workItemId: detail.items[0]!.itemId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects QC before the first version and audits the blocked attempt", async () => {
    const partner = callerFor("partner");
    const asset = await createOrganizationAsset("Empty QC asset");
    await expect(
      partner.assets.qc({ id: asset.assetId, decision: "pass" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      getDemoStore().audits.some(
        (row) =>
          row.action === "assets.qc.blocked" &&
          row.entityId === asset.assetId &&
          row.reason === "At least one asset version is required before QC",
      ),
    ).toBe(true);
  });

  it("requires QC authority and notes while auditing blocked and completed decisions", async () => {
    const asset = await createOrganizationAsset("QC artwork");
    const partner = callerFor("partner");
    await partner.assets.uploadVersion({
      assetId: asset.assetId,
      fileName: "qc.png",
      contentType: "image/png",
      contentBase64: PNG,
    });

    await expect(
      partner.assets.qc({ id: asset.assetId, decision: "fail" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      partner.assets.qc({ id: asset.assetId, decision: "waive" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const blocked = await callerFor("am").assets.qc({
      id: asset.assetId,
      decision: "pass",
    });
    expect(blocked).toMatchObject({ ok: false, code: "GATE_BLOCKED" });
    expect(
      getDemoStore().audits.some(
        (row) =>
          row.action === "assets.qc.blocked" && row.entityId === asset.assetId,
      ),
    ).toBe(true);

    const failed = await callerFor("creative_director").assets.qc({
      id: asset.assetId,
      decision: "fail",
      notes: "Typography needs correction",
    });
    expect(failed.ok && failed.asset.status).toBe("internal_review");
    const waived = await callerFor("creative_director").assets.qc({
      id: asset.assetId,
      decision: "waive",
      notes: "Approved exception",
    });
    expect(waived.ok && waived.asset.status).toBe("qc_passed");
    expect(
      getDemoStore().audits.some(
        (row) =>
          row.action === "assets.qc" && row.reason === "Approved exception",
      ),
    ).toBe(true);
  });

  it("removes a partially stored object and version record when upload fails", async () => {
    const objects = new Set<string>();
    const remove = vi.fn(async (path: string) => {
      objects.delete(path);
    });
    getDemoStore().objectStore = {
      async put(input) {
        objects.add(input.path);
        throw new Error("simulated storage failure");
      },
      async signedUrl() {
        throw new Error("not expected");
      },
      remove,
    };
    const partner = callerFor("partner");
    const asset = await partner.assets.create({
      title: "Failed upload",
      workItemId: ITEM_ID,
    });

    await expect(
      partner.assets.uploadVersion({
        assetId: asset.assetId,
        fileName: "orphan.png",
        contentType: "image/png",
        contentBase64: PNG,
      }),
    ).rejects.toThrow("simulated storage failure");
    expect(objects.size).toBe(0);
    expect(remove).toHaveBeenCalledOnce();
    expect((await partner.assets.get({ id: asset.assetId }))?.versions).toEqual(
      [],
    );
    expect(
      getDemoStore().audits.some(
        (row) => row.action === "assets.uploadVersion",
      ),
    ).toBe(false);
  });
});
