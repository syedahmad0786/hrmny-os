process.env.DATABASE_URL = "";

import { type Db } from "@hrmny/db";
import { beforeEach, expect, it, vi } from "vitest";
import { withDatabaseScope } from "../db";
import { resetCrmMemory } from "./memory";
import { createContact, listContacts } from "./repository";

const COMPANY = "c0000000-0000-4000-8000-000000000061";
const OTHER_COMPANY = "c0000000-0000-4000-8000-000000000062";

beforeEach(() => {
  resetCrmMemory().contacts.clear();
});

it("matches full contact names and preserves email and company filters in both repository modes", async () => {
  const tom = await createContact({
    companyId: COMPANY,
    firstName: "Tom",
    lastName: "Fux",
    email: "tom.fux@example.test",
  });
  const other = await createContact({
    companyId: OTHER_COMPANY,
    firstName: "Tom",
    lastName: "Fux",
    email: "other.tom@example.test",
  });

  const assertSearches = async () => {
    await expect(
      listContacts({ companyId: COMPANY, search: "Tom Fux" }),
    ).resolves.toMatchObject([{ contactId: tom.contactId }]);
    await expect(
      listContacts({ companyId: COMPANY, search: "tom.fux@example.test" }),
    ).resolves.toMatchObject([{ contactId: tom.contactId }]);
    await expect(
      listContacts({
        companyId: OTHER_COMPANY,
        search: "tom.fux@example.test",
      }),
    ).resolves.toEqual([]);
  };

  await assertSearches();

  const rows = [tom, other];
  const database = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })),
    })),
    execute: vi.fn(async () => []),
  } as unknown as Db;
  await withDatabaseScope(database, assertSearches);
});
