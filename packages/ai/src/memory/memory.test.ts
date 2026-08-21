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

  it("isolates user sandbox from client-tagged notes", () => {
    const employeeId = "e1000000-0000-4000-8000-000000000001";
    const clientId = "c1000000-0000-4000-8000-000000000001";
    const rows = [
      {
        id: "1",
        sourceType: "note" as const,
        sourceId: null,
        content: "user-only preference about briefing tone",
        metadata: { employeeId },
      },
      {
        id: "2",
        sourceType: "note" as const,
        sourceId: null,
        content: "client campaign brief for dual-tagged run",
        metadata: { employeeId, clientId },
      },
    ];
    const userHits = keywordSearchFromRows(rows, {
      query: "brief",
      employeeId,
      limit: 10,
    });
    expect(userHits.map((h) => h.id)).toEqual(["1"]);
    expect(userHits[0]?.content).toMatch(/user-only/i);

    const clientHits = keywordSearchFromRows(rows, {
      query: "brief",
      employeeId,
      clientId,
      limit: 10,
    });
    // Client sandbox requires matching clientId — user-only notes stay out.
    expect(clientHits.map((h) => h.id)).toEqual(["2"]);
  });

  it("isolates employee A user sandbox from employee B", () => {
    const employeeA = "e1000000-0000-4000-8000-0000000000aa";
    const employeeB = "e1000000-0000-4000-8000-0000000000bb";
    const rows = [
      {
        id: "a1",
        sourceType: "note" as const,
        sourceId: null,
        content: "partner-only briefing preference for employee A",
        metadata: { employeeId: employeeA },
      },
      {
        id: "b1",
        sourceType: "note" as const,
        sourceId: null,
        content: "finance-only cashflow note for employee B",
        metadata: { employeeId: employeeB },
      },
    ];
    const aHits = keywordSearchFromRows(rows, {
      query: "briefing cashflow preference",
      employeeId: employeeA,
      limit: 10,
    });
    expect(aHits.map((h) => h.id)).toEqual(["a1"]);
    expect(aHits[0]?.content).toMatch(/employee A/i);

    const bHits = keywordSearchFromRows(rows, {
      query: "briefing cashflow preference",
      employeeId: employeeB,
      limit: 10,
    });
    expect(bHits.map((h) => h.id)).toEqual(["b1"]);
    expect(bHits[0]?.content).toMatch(/employee B/i);
  });

});
