import { beforeEach, describe, expect, it } from "vitest";
import {
  getOutreach,
  insertContactEdge,
  insertCompetitorFindings,
  insertOutreach,
  insertWinLossNote,
  listContactEdges,
  listCompetitorFindings,
  listOutreach,
  listWinLossNotes,
  patchOutreach,
  resetLeadgenStore,
} from "./store";

// Memory-mode round trips (no DATABASE_URL in tests). The Postgres branch is
// the same withDb seam as crm/repository.ts and shares these interfaces.
describe("leadgen store (memory mode)", () => {
  beforeEach(() => resetLeadgenStore());

  it("round-trips an outreach item draft → approved → sent", async () => {
    const item = await insertOutreach({
      dealId: "d-1",
      channel: "gmail",
      recipient: "sara@acme.example",
      subject: "Hi",
      body: "Hello",
    });
    expect(item.state).toBe("draft");

    const approved = await patchOutreach(item.id, {
      state: "approved",
      approvedBy: "emp-1",
    });
    expect(approved?.state).toBe("approved");
    expect(approved?.approvedBy).toBe("emp-1");

    const sentAt = new Date().toISOString();
    const sent = await patchOutreach(item.id, {
      state: "sent",
      sentAt,
      externalId: "ext-1",
    });
    expect(sent?.state).toBe("sent");
    expect(sent?.externalId).toBe("ext-1");

    const fetched = await getOutreach(item.id);
    expect(fetched?.state).toBe("sent");
    expect(fetched?.sentAt).toBe(sentAt);

    expect(await listOutreach({ dealId: "d-1", state: "sent" })).toHaveLength(1);
    expect(await listOutreach({ state: "draft" })).toHaveLength(0);
    expect(await patchOutreach("missing", { state: "sent" })).toBeNull();
    expect(await getOutreach("missing")).toBeNull();
  });

  it("writes and lists competitor findings scoped by scopeId", async () => {
    const rows = await insertCompetitorFindings([
      {
        competitor: "Rival",
        source: "site",
        headline: "h",
        detail: "d",
        capturedAt: new Date().toISOString(),
        scopeId: "deal-1",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBeTruthy();
    expect(await listCompetitorFindings("deal-1")).toHaveLength(1);
    expect(await listCompetitorFindings("other")).toHaveLength(0);
    expect(await insertCompetitorFindings([])).toHaveLength(0);
  });

  it("writes lead_intel contact edges and lists by either endpoint", async () => {
    const edge = await insertContactEdge({
      fromContact: "c-1",
      toContact: "c-2",
      relation: "colleague",
      weight: 0.8,
    });
    expect(edge.weight).toBe(0.8);

    expect(await listContactEdges("c-1")).toHaveLength(1);
    expect(await listContactEdges("c-2")).toHaveLength(1);
    expect(await listContactEdges("c-3")).toHaveLength(0);
    expect(await listContactEdges()).toHaveLength(1);
  });

  it("writes lead_intel win/loss notes and filters by deal and outcome", async () => {
    await insertWinLossNote({ dealId: "d-1", outcome: "won", note: "price" });
    await insertWinLossNote({ dealId: "d-2", outcome: "lost", note: "timing" });

    expect(await listWinLossNotes({ dealId: "d-1" })).toHaveLength(1);
    expect(await listWinLossNotes({ outcome: "lost" })).toHaveLength(1);
    expect(await listWinLossNotes()).toHaveLength(2);
    expect((await listWinLossNotes({ outcome: "lost" }))[0]!.note).toBe("timing");
  });
});
