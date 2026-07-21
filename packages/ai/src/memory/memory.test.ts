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
});
