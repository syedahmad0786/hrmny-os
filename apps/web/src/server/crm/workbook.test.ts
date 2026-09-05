import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "../trpc/root";
import { resetCrmMemory } from "./memory";
import {
  createActivity,
  createCompany,
  createContact,
  createCrmTask,
  createDeal,
  getCompany,
  getContact,
  listContacts,
  updateContact,
  updateCompany,
} from "./repository";
import { defaultWorkbookConfig, filterWorkbookRows } from "@/lib/crm-workbook";
import { workbookXlsx } from "@/lib/workbook-download";

function caller(role = "partner") {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}
describe("CRM workbook acceptance", () => {
  beforeEach(resetCrmMemory);
  it("uses actual interactions across the full history and excludes private history and edits", async () => {
    const person = await createContact({ firstName: "Operator" });
    await createActivity({
      type: "call",
      contactId: person.contactId,
      occurredAt: "2025-01-01T12:00:00Z",
    });
    await Promise.all(
      Array.from({ length: 210 }, () =>
        createActivity({ type: "system", contactId: person.contactId }),
      ),
    );
    await createActivity({
      type: "email",
      contactId: person.contactId,
      occurredAt: "2026-08-01T12:00:00Z",
      metadata: { visibility: "private" },
      body: "Private mail never in workbook",
    });
    await updateContact(person.contactId, { title: "Director" });
    expect(
      (await listContacts()).find((c) => c.contactId === person.contactId)
        ?.lastInteractionAt,
    ).toBe("2025-01-01T12:00:00.000Z");
    const snapshot = await caller("am").crm.workbook.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain("Private mail never");
  });
  it("invalidates verification only when the address changes", async () => {
    const person = await createContact({
      firstName: "Owner",
      email: "old@brand.ae",
    });
    await updateContact(person.contactId, { emailVerified: true });
    await updateContact(person.contactId, { title: "Partner" });
    expect((await getContact(person.contactId))?.emailVerified).toBe(true);
    await caller().crm.contacts.update({
      id: person.contactId,
      email: "new@brand.ae",
    });
    expect((await getContact(person.contactId))?.emailVerified).toBe(false);
  });
  it("previews imports without writes, links companies, and survives replay without emails", async () => {
    const company = await createCompany({ name: "Cedar Hospitality" });
    const rows = [
      { firstName: "Noor", lastName: "Saleh", companyName: company.name },
    ];
    const plan = await caller().crm.import.preview({ kind: "contacts", rows });
    expect(plan[0]?.action).toBe("create");
    expect((await listContacts()).some((c) => c.firstName === "Noor")).toBe(
      false,
    );
    expect((await caller().crm.import.contacts({ rows })).created).toBe(1);
    expect((await caller().crm.import.contacts({ rows })).skipped).toBe(1);
    expect(
      (await listContacts()).find((c) => c.firstName === "Noor")?.companyId,
    ).toBe(company.companyId);
  });
  it("rejects ambiguous company matches and wrongly mapped email names", async () => {
    await createCompany({ name: "Cedar" });
    await createCompany({ name: "Cedar" });
    const plan = await caller().crm.import.preview({
      kind: "contacts",
      rows: [
        { firstName: "Noor", companyName: "Cedar" },
        { firstName: "noor@cedar.ae" },
      ],
    });
    expect(plan.every((r) => r.action === "invalid")).toBe(true);
  });
  it("keeps personal views private and team view edits with their owner", async () => {
    const config = defaultWorkbookConfig("contacts");
    const personal = await caller().crm.workbook.saveView({
      name: "My relationships",
      visibility: "personal",
      config,
    });
    const team = await caller().crm.workbook.saveView({
      name: "Our accounts",
      visibility: "team",
      config,
    });
    const other = await caller("am").crm.workbook.views();
    expect(other.some((v) => v.id === personal.id)).toBe(false);
    expect(other.some((v) => v.id === team.id)).toBe(true);
    await expect(
      caller("am").crm.workbook.saveView({ ...team, name: "Hijacked" }),
    ).rejects.toThrow();
    await expect(
      caller("am").crm.workbook.deleteView({ id: personal.id }),
    ).rejects.toThrow();
  });
  it("refuses a stale bulk update before changing any of the selected records", async () => {
    const first = await createCompany({ name: "First operating company" }),
      second = await createCompany({ name: "Second operating company" });
    const initial = (await caller().crm.workbook.snapshot()).rows;
    await updateCompany(second.companyId, {
      name: "Changed by another employee",
    });
    const records = [first.companyId, second.companyId].map((id) => ({
      id,
      updatedAt: initial.find((r) => r.id === id)!.updatedAt,
    }));
    // Force stale stamp even on a machine whose clock has not advanced a millisecond.
    records[1]!.updatedAt = "2020-01-01T00:00:00Z";
    await expect(
      caller().crm.workbook.edit({
        kind: "companies",
        field: "ownerId",
        value: resolveDevUser("am").employeeId,
        records,
      }),
    ).rejects.toThrow(/changed/);
    expect((await getCompany(first.companyId))?.ownerEmployeeId).toBeFalsy();
    await expect(
      caller().crm.workbook.edit({
        kind: "companies",
        field: "ownerId",
        value: randomUUID(),
        records: [records[0]!],
      }),
    ).rejects.toThrow(/active employee/);
  });
  it("exports the same filtered authorized records and never hidden test records or costs", async () => {
    const company = await createCompany({ name: "Workbook Real Company" });
    await createDeal({
      companyId: company.companyId,
      companyName: company.name,
    });
    await createDeal({ companyName: "E2E Workbook fixture" });
    const config = {
      ...defaultWorkbookConfig("deals"),
      search: "Workbook",
      columns: ["name", "value", "internalCost", "body"],
    };
    const exported = await caller("am").crm.workbook.export({
      config,
      allTabs: false,
    });
    expect(exported.sheets[0]?.rows).toHaveLength(1);
    expect(exported.csv).toContain("Workbook Real Company");
    expect(exported.csv).not.toMatch(/fixture|internalCost|body/);
    await expect(caller("portal_a").crm.workbook.snapshot()).rejects.toThrow(
      /portal/,
    );
  });
  it("flags a next action without a date and finds overdue follow-ups", async () => {
    const deal = await createDeal({ companyName: "Real commitments" });
    await createCrmTask({ title: "Call buyer", dealId: deal.dealId });
    const snapshot = await caller().crm.workbook.snapshot();
    expect(
      filterWorkbookRows(
        snapshot.rows,
        { ...defaultWorkbookConfig("deals"), attention: "no_next_action" },
        "",
      ).some((r) => r.id === deal.dealId),
    ).toBe(true);
    const task = await createCrmTask({
      title: "Overdue call",
      dealId: deal.dealId,
      dueDate: "2020-01-01",
    });
    expect(
      filterWorkbookRows(
        (await caller().crm.workbook.snapshot()).rows,
        { ...defaultWorkbookConfig("followups"), attention: "overdue" },
        "",
      ).some((r) => r.id === task.crmTaskId),
    ).toBe(true);
  });
  it("writes a real XLSX archive with literal text cells for formulas and Unicode", () => {
    const bytes = workbookXlsx([
      {
        name: "Contacts",
        headers: ["Name"],
        rows: [['=HYPERLINK("https://invalid")'], ["نور & Molham"]],
      },
    ]);
    const view = new DataView(bytes.buffer),
      text = new TextDecoder().decode(bytes);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(text).toContain('t="inlineStr"');
    expect(text).toContain("نور &amp; Molham");
    expect(text).not.toContain("<f>");
  });
  it("imports reviewed client projects once without inventing revenue and supports account ownership", async () => {
    const clientName = `Cedar ${randomUUID()}`;
    const stamp = String(Date.now());
    const rows = [1, 2].map((n) => ({
      clientName,
      projectName: `Cedar project ${n}`,
      workspaceId: "1148006162435561",
      projectId: `${stamp}${n}`,
      observedAt: "2026-01-01T00:00:00Z",
    }));
    await expect(
      caller("am").clients.importAsanaRoster({ rows }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await caller().clients.previewAsanaRoster({ rows })).every(
        (r) => r.action === "create",
      ),
    ).toBe(true);
    expect(await caller().clients.importAsanaRoster({ rows })).toEqual({
      created: 1,
      linked: 2,
      skipped: 0,
    });
    expect(await caller().clients.importAsanaRoster({ rows })).toEqual({
      created: 0,
      linked: 0,
      skipped: 2,
    });
    await expect(
      caller().clients.importAsanaRoster({
        rows: [{ ...rows[0]!, clientName: "Different account" }],
      }),
    ).rejects.toThrow(/invalid row/);
    const client = (await caller().crm.workbook.snapshot()).rows.find(
      (r) => r.kind === "clients" && r.name === clientName,
    )!;
    expect(client.value).toBe("");
    expect(client.renewal).toBe("");
    expect(client.ownerId).toBeNull();
    const deal = (await caller().crm.deals.list()).find(
      (d) => d.companyName === clientName,
    )!;
    expect(deal.closedAt).toBeNull();
    expect(deal.quoteValue).toBeNull();
    await caller().crm.workbook.edit({
      kind: "clients",
      records: [{ id: client.id, updatedAt: client.updatedAt }],
      field: "ownerId",
      value: resolveDevUser("am").employeeId,
    });
    const assigned = (await caller().crm.workbook.snapshot()).rows.find(
      (r) => r.id === client.id,
    )!;
    expect(assigned.owner).toBe("Dev AM");
    await caller().crm.workbook.edit({
      kind: "clients",
      records: [{ id: client.id, updatedAt: assigned.updatedAt }],
      field: "ownerId",
      value: null,
    });
    expect(
      (await caller().crm.workbook.snapshot()).rows.find(
        (r) => r.id === client.id,
      )?.ownerId,
    ).toBeNull();
    expect(
      await caller().clients.sourceProjects({ clientId: client.id }),
    ).toHaveLength(2);
  });
  it("rejects a follow-up linked to conflicting companies", async () => {
    const a = await createCompany({ name: "First buyer" });
    const b = await createCompany({ name: "Second buyer" });
    const d = await createDeal({ companyName: a.name, companyId: a.companyId });
    await expect(
      createCrmTask({
        title: "Wrong relationship",
        dealId: d.dealId,
        companyId: b.companyId,
      }),
    ).rejects.toThrow(/match/);
    expect(
      (await createCrmTask({ title: "Correct relationship", dealId: d.dealId }))
        .companyId,
    ).toBe(a.companyId);
  });
});
