import { beforeEach, describe, expect, it } from "vitest";
import { resetIntegrationReceiptMemory } from "./integrations/inbox";
import {
  GbrainError,
  callGbrainTool,
  gbrainConfiguration,
  projectKnowledgeArticle,
  publishKnowledgeToGbrain,
  writeKnowledgeProjection,
} from "./gbrain";

const env = {
  GBRAIN_MCP_URL: "https://brain.example.com",
  GBRAIN_ACCESS_TOKEN: "test-token-not-live",
  GBRAIN_SOURCE_ID: "hrmny-os",
};

const article = {
  articleId: "00000000-0000-4000-8000-000000000010",
  slug: "expense-policy",
  title: "Expense policy",
  category: "Finance",
  version: 2,
  body: "Submit receipts within 30 days.\r\n",
};

function result(value: unknown, isError = false) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "test",
      result: {
        content: [{ type: "text", text: JSON.stringify(value) }],
        ...(isError ? { isError: true } : {}),
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

describe("GBrain knowledge projection", () => {
  beforeEach(() => resetIntegrationReceiptMemory());

  it("builds deterministic, HRMNY-owned markdown and validates config", () => {
    const first = projectKnowledgeArticle(article);
    const second = projectKnowledgeArticle({ ...article, body: article.body });
    expect(first).toMatchObject({
      gbrainSlug: "hrmny/knowledge/expense-policy",
      contentHash: second.contentHash,
    });
    expect(first.content).toContain(
      `hrmny_content_sha256: "${first.contentHash}"`,
    );
    expect(first.content).toContain("visibility: world");
    expect(first.content).not.toContain(env.GBRAIN_ACCESS_TOKEN);
    expect(gbrainConfiguration(env).endpoint).toBe(
      "https://brain.example.com/mcp",
    );
    expect(() =>
      gbrainConfiguration({
        ...env,
        GBRAIN_MCP_URL: "http://brain.example.com",
      }),
    ).toThrowError(new GbrainError("GBRAIN_INVALID_MCP_URL"));
  });

  it("unwraps the standard MCP result and rejects a tool error", async () => {
    const fetcher = (async () => result({ status: "ok" })) as typeof fetch;
    await expect(
      callGbrainTool(
        "get_page",
        { slug: "hrmny/knowledge/x" },
        { env, fetch: fetcher },
      ),
    ).resolves.toEqual({ status: "ok" });

    const failing = (async () =>
      result({ error: "permission_denied" }, true)) as typeof fetch;
    await expect(
      callGbrainTool(
        "get_page",
        { slug: "hrmny/knowledge/x" },
        { env, fetch: failing },
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("reads before writing and verifies the provider read-back", async () => {
    const projection = projectKnowledgeArticle(article);
    const calls: string[] = [];
    let stored = false;
    const fetcher = (async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        params: { name: string };
      };
      calls.push(request.params.name);
      if (request.params.name === "put_page") {
        stored = true;
        return result({ status: "created_or_updated" });
      }
      return stored
        ? result({
            slug: projection.gbrainSlug,
            source_id: env.GBRAIN_SOURCE_ID,
            deleted_at: null,
            frontmatter: {
              hrmny_article_id: projection.articleId,
              hrmny_content_sha256: projection.contentHash,
            },
          })
        : result({ error: "page_not_found" }, true);
    }) as typeof fetch;

    await expect(
      writeKnowledgeProjection(projection, { env, fetch: fetcher }),
    ).resolves.toEqual({
      bridgeStatus: "verified",
      result: "created_or_updated",
    });
    expect(calls).toEqual(["get_page", "put_page", "get_page"]);
  });

  it("uses one durable receipt and performs no provider call on replay", async () => {
    const projection = projectKnowledgeArticle(article);
    let providerCalls = 0;
    let stored = false;
    const fetcher = (async (_input, init) => {
      providerCalls += 1;
      const request = JSON.parse(String(init?.body)) as {
        params: { name: string };
      };
      if (request.params.name === "put_page") {
        stored = true;
        return result({ status: "created_or_updated" });
      }
      return stored
        ? result({
            slug: projection.gbrainSlug,
            source_id: env.GBRAIN_SOURCE_ID,
            deleted_at: null,
            frontmatter: {
              hrmny_article_id: projection.articleId,
              hrmny_content_sha256: projection.contentHash,
            },
          })
        : result({ error: "page_not_found" }, true);
    }) as typeof fetch;

    const first = await publishKnowledgeToGbrain(
      article,
      "00000000-0000-4000-8000-000000000001",
      { env, fetch: fetcher },
    );
    const replay = await publishKnowledgeToGbrain(
      article,
      "00000000-0000-4000-8000-000000000001",
      { env, fetch: fetcher },
    );
    expect(first.replay).toBe(false);
    expect(replay).toMatchObject({ receiptId: first.receiptId, replay: true });
    expect(providerCalls).toBe(3);
  });

  it("keeps a failed attempt retryable and then verifies without duplicating the receipt", async () => {
    const projection = projectKnowledgeArticle(article);
    let failOnce = true;
    let stored = false;
    const fetcher = (async (_input, init) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("network detail must not escape");
      }
      const request = JSON.parse(String(init?.body)) as {
        params: { name: string };
      };
      if (request.params.name === "put_page") {
        stored = true;
        return result({ status: "created_or_updated" });
      }
      return stored
        ? result({
            slug: projection.gbrainSlug,
            source_id: env.GBRAIN_SOURCE_ID,
            deleted_at: null,
            frontmatter: {
              hrmny_article_id: projection.articleId,
              hrmny_content_sha256: projection.contentHash,
            },
          })
        : result({ error: "page_not_found" }, true);
    }) as typeof fetch;

    await expect(
      publishKnowledgeToGbrain(
        article,
        "00000000-0000-4000-8000-000000000001",
        { env, fetch: fetcher },
      ),
    ).rejects.toMatchObject({ code: "GBRAIN_UNAVAILABLE" });
    await expect(
      publishKnowledgeToGbrain(
        article,
        "00000000-0000-4000-8000-000000000001",
        { env, fetch: fetcher },
      ),
    ).resolves.toMatchObject({ replay: false });
  });
});
