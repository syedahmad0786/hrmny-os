import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("/api/ready", () => {
  it("returns llm and platform fields without secrets", async () => {
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(body.ok ? 200 : 503);
    expect(body).toHaveProperty("llmProvider");
    expect(body).toHaveProperty("llmDefaultModel");
    expect(body).toHaveProperty("llmFreeOnly");
    expect(body).toHaveProperty("database");
    expect(body).toHaveProperty("pgvector");
    expect(body).toHaveProperty("integrationInbox");
    expect(body).toHaveProperty("tools");
    expect(body).toHaveProperty("blockers");
    expect(body).not.toHaveProperty("OPENROUTER_API_KEY");
  });
});
