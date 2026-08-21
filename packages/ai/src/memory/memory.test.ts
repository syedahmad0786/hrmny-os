import { describe, expect, it } from "vitest";
import {
  createInMemoryMemoryStore,
  upsertMemoryChunk,
  retrieveMemory,
  keywordSearchFromRows,
} from "./index";

describe("memory stubs", () => {
  it("upserts and retrieves by keyword", async () => {
    const store = createInMemoryMemoryStore();
    await upsertMemoryChunk(
      {
        sourceType: "note",
        content: "Client prefers morning shoots in Dubai Marina",
        metadata: { dealId: "00000000-0000-4000-8000-000000000001" },
      },
      { persist: store.persist },
    );

    const results = await retrieveMemory(
      {
        query: "Dubai Marina shoots",
        dealId: "00000000-0000-4000-8000-000000000001",
        limit: 5,
      },
      {
        search: (input) =>
          Promise.resolve(keywordSearchFromRows(store.rows.values(), input)),
      },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toMatch(/Marina/);
  });

  it("isolates client sandboxes", () => {
    const a = "00000000-0000-4000-8000-0000000000aa";
    const b = "00000000-0000-4000-8000-0000000000bb";
    const rows = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        sourceType: "note" as const,
        sourceId: null,
        content: "Client A brand tone is warm",
        metadata: { clientId: a },
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        sourceType: "note" as const,
        sourceId: null,
        content: "Client B secret brief",
        metadata: { clientId: b },
      },
    ];
    const hits = keywordSearchFromRows(rows, {
      query: "brand tone secret",
      clientId: a,
      limit: 5,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toMatch(/Client A/);
  });
});
