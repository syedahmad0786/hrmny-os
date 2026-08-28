import { afterEach, describe, expect, it, vi } from "vitest";
import { embedText, searchMemory } from "./memory-db";

describe("memory embedding provider boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("leaves embeddings absent when no provider is selected", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "");
    vi.stubEnv("LLM_PROVIDER", "mock");
    await expect(embedText("hello")).resolves.toBeNull();
  });

  it("requires an explicit local-embedding approval", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "local");
    vi.stubEnv("ALLOW_LOCAL_EMBEDDINGS", "");
    await expect(embedText("hello")).resolves.toBeNull();

    vi.stubEnv("ALLOW_LOCAL_EMBEDDINGS", "true");
    const vector = await embedText("hello");
    expect(vector).toHaveLength(1536);
  });

  it("uses the official OpenAI embeddings endpoint and key reference", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.01) }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(embedText("hello")).resolves.toHaveLength(1536);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-openai-key",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
  });

  it("fails loud on a live provider error instead of writing a local vector", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { status: 429 })),
    );
    await expect(embedText("hello")).rejects.toThrow(
      "EMBEDDING_PROVIDER_ERROR:openrouter:429",
    );
  });

  it("refuses an unscoped memory search", async () => {
    await expect(
      searchMemory({ query: "customer context", limit: 5 }),
    ).rejects.toThrow("MEMORY_SCOPE_REQUIRED");
  });
});
