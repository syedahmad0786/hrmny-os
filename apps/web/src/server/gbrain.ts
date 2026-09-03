import { createHash, randomUUID } from "node:crypto";
import {
  beginIntegrationReceiptAttempt,
  completeIntegrationReceiptIfProcessing,
  getIntegrationReceipt,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
  type IntegrationReceipt,
} from "./integrations/inbox";

export const GBRAIN_UPSTREAM_REVISION =
  "5cfb84f1d3a809c70064c292c23db3d538d5c551";
export const GBRAIN_UPSTREAM_VERSION = "0.48.2.0";
export const GBRAIN_SHARE_CONFIRMATION = "SHARE WITH COMPANY BRAIN";

const RESPONSE_LIMIT_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 3;

type Environment = Record<string, string | undefined>;
type Fetcher = typeof globalThis.fetch;
type JsonObject = Record<string, unknown>;

export type PublishedKnowledgeArticle = {
  articleId: string;
  slug: string;
  title: string;
  category: string;
  version: number;
  body: string;
};

export type KnowledgeProjection = PublishedKnowledgeArticle & {
  gbrainSlug: string;
  content: string;
  contentHash: string;
  bytes: number;
};

export class GbrainError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "GbrainError";
  }
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function safeCode(value: unknown, fallback = "GBRAIN_PROVIDER_ERROR") {
  const code = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,80}$/.test(code) ? code : fallback;
}

function normalizeText(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function projectKnowledgeArticle(
  article: PublishedKnowledgeArticle,
): KnowledgeProjection {
  const slug = article.slug.trim().toLowerCase();
  const title = article.title.trim();
  const category = article.category.trim();
  const body = normalizeText(article.body);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new GbrainError("GBRAIN_INVALID_ARTICLE_SLUG");
  }
  if (!article.articleId.trim() || !title || !category || !body) {
    throw new GbrainError("GBRAIN_INVALID_ARTICLE");
  }
  if (!Number.isSafeInteger(article.version) || article.version < 1) {
    throw new GbrainError("GBRAIN_INVALID_ARTICLE_VERSION");
  }

  const normalized = {
    articleId: article.articleId.trim(),
    slug,
    title,
    category,
    version: article.version,
    body,
  };
  const contentHash = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  const gbrainSlug = `hrmny/knowledge/${slug}`;
  const content = [
    "---",
    `title: ${JSON.stringify(title)}`,
    "type: note",
    `hrmny_article_id: ${JSON.stringify(normalized.articleId)}`,
    `hrmny_version: ${article.version}`,
    `hrmny_category: ${JSON.stringify(category)}`,
    `hrmny_content_sha256: ${JSON.stringify(contentHash)}`,
    "visibility: world",
    "---",
    "",
    `# ${title}`,
    "",
    body,
    "",
  ].join("\n");

  return {
    ...normalized,
    gbrainSlug,
    content,
    contentHash,
    bytes: Buffer.byteLength(content),
  };
}

export function gbrainConfiguration(env: Environment = process.env) {
  const rawUrl = env.GBRAIN_MCP_URL?.trim();
  const token = env.GBRAIN_ACCESS_TOKEN?.trim();
  const sourceId = env.GBRAIN_SOURCE_ID?.trim();
  if (!rawUrl || !token || !sourceId) {
    throw new GbrainError("GBRAIN_NOT_CONFIGURED");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(sourceId)) {
    throw new GbrainError("GBRAIN_INVALID_SOURCE_ID");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(rawUrl);
  } catch {
    throw new GbrainError("GBRAIN_INVALID_MCP_URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== "https:" &&
      !(local && endpoint.protocol === "http:"))
  ) {
    throw new GbrainError("GBRAIN_INVALID_MCP_URL");
  }
  const path = endpoint.pathname.replace(/\/+$/, "");
  endpoint.pathname = path.endsWith("/mcp") ? path : `${path}/mcp`;

  return { endpoint: endpoint.toString(), token, sourceId };
}

export function gbrainConfigured(env: Environment = process.env): boolean {
  try {
    gbrainConfiguration(env);
    return true;
  } catch {
    return false;
  }
}

function parseWireBody(text: string, contentType: string): JsonObject {
  const payloads = contentType.includes("text/event-stream")
    ? text
        .split(/\r?\n\r?\n/)
        .map((event) =>
          event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n"),
        )
        .filter((value) => value && value !== "[DONE]")
    : [text];
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = object(JSON.parse(payloads[index]!));
      if (parsed) return parsed;
    } catch {
      // Keep looking for the final JSON event in an SSE response.
    }
  }
  throw new GbrainError("GBRAIN_INVALID_RESPONSE");
}

function unwrapToolResult(envelope: JsonObject): unknown {
  if (envelope.error) {
    const rpcError = object(envelope.error);
    throw new GbrainError(safeCode(rpcError?.code, "GBRAIN_RPC_ERROR"));
  }
  const result = "result" in envelope ? envelope.result : envelope;
  const toolResult = object(result);
  if (!toolResult || !Array.isArray(toolResult.content)) return result;

  const firstText = toolResult.content.find(
    (item) =>
      object(item)?.type === "text" && typeof object(item)?.text === "string",
  );
  const text = object(firstText)?.text;
  let parsed: unknown = text;
  if (typeof text === "string") {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Older servers may return a plain-text error; never reflect it verbatim.
    }
  }
  if (toolResult.isError === true) {
    throw new GbrainError(safeCode(object(parsed)?.error));
  }
  return parsed;
}

export async function callGbrainTool(
  name: "get_page" | "put_page",
  args: JsonObject,
  options: { env?: Environment; fetch?: Fetcher } = {},
): Promise<unknown> {
  const config = gbrainConfiguration(options.env);
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(config.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof GbrainError) throw error;
    throw new GbrainError(
      error instanceof DOMException && error.name === "TimeoutError"
        ? "GBRAIN_TIMEOUT"
        : "GBRAIN_UNAVAILABLE",
    );
  }
  if (!response.ok) {
    throw new GbrainError(
      response.status === 401 || response.status === 403
        ? "GBRAIN_AUTH_FAILED"
        : `GBRAIN_HTTP_${response.status}`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > RESPONSE_LIMIT_BYTES) {
    throw new GbrainError("GBRAIN_RESPONSE_TOO_LARGE");
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw new GbrainError("GBRAIN_INVALID_RESPONSE");
  }
  if (bytes.byteLength > RESPONSE_LIMIT_BYTES) {
    throw new GbrainError("GBRAIN_RESPONSE_TOO_LARGE");
  }
  const envelope = parseWireBody(
    new TextDecoder().decode(bytes),
    response.headers.get("content-type") ?? "application/json",
  );
  return unwrapToolResult(envelope);
}

function verifiedPage(
  page: unknown,
  projection: KnowledgeProjection,
  sourceId: string,
) {
  const row = object(page);
  const frontmatter = object(row?.frontmatter);
  return Boolean(
    row &&
    row.slug === projection.gbrainSlug &&
    row.source_id === sourceId &&
    !row.deleted_at &&
    frontmatter?.hrmny_article_id === projection.articleId &&
    frontmatter.hrmny_content_sha256 === projection.contentHash,
  );
}

async function readPage(
  projection: KnowledgeProjection,
  options: { env?: Environment; fetch?: Fetcher },
) {
  const { sourceId } = gbrainConfiguration(options.env);
  try {
    return await callGbrainTool(
      "get_page",
      {
        slug: projection.gbrainSlug,
        source_id: sourceId,
        include_deleted: true,
      },
      options,
    );
  } catch (error) {
    if (error instanceof GbrainError && error.code === "page_not_found") {
      return null;
    }
    throw error;
  }
}

export async function writeKnowledgeProjection(
  projection: KnowledgeProjection,
  options: { env?: Environment; fetch?: Fetcher } = {},
) {
  const { sourceId } = gbrainConfiguration(options.env);
  const existing = await readPage(projection, options);
  if (existing) {
    const row = object(existing);
    const frontmatter = object(row?.frontmatter);
    if (frontmatter?.hrmny_article_id !== projection.articleId) {
      throw new GbrainError("GBRAIN_SLUG_CONFLICT");
    }
    if (verifiedPage(existing, projection, sourceId)) {
      return { bridgeStatus: "verified", result: "already_current" } as const;
    }
  }

  await callGbrainTool(
    "put_page",
    { slug: projection.gbrainSlug, content: projection.content },
    options,
  );
  const readback = await readPage(projection, options);
  if (!verifiedPage(readback, projection, sourceId)) {
    throw new GbrainError("GBRAIN_READBACK_MISMATCH");
  }
  return { bridgeStatus: "verified", result: "created_or_updated" } as const;
}

function bridgeResult(receipt: IntegrationReceipt) {
  return object(receipt.result)?.bridgeStatus;
}

function leaseExpired(receipt: IntegrationReceipt) {
  if (!receipt.attemptLeaseExpiresAt) return false;
  const expires = new Date(receipt.attemptLeaseExpiresAt).getTime();
  return Number.isFinite(expires) && expires <= Date.now();
}

export async function publishKnowledgeToGbrain(
  article: PublishedKnowledgeArticle,
  ownerEmployeeId: string,
  options: { env?: Environment; fetch?: Fetcher } = {},
) {
  const projection = projectKnowledgeArticle(article);
  const { sourceId } = gbrainConfiguration(options.env);
  const externalEventId = `knowledge:${projection.articleId}:v${projection.version}:project`;
  let receipt = await recordIntegrationReceipt({
    provider: "gbrain",
    externalEventId,
    operation: "put_page",
    rawBody: projection.content,
    status: "received",
    ownerEmployeeId,
    payload: {
      articleId: projection.articleId,
      version: projection.version,
      slug: projection.gbrainSlug,
      contentHash: projection.contentHash,
      sourceId,
      upstreamRevision: GBRAIN_UPSTREAM_REVISION,
    },
  });

  if (
    receipt.status === "completed" &&
    bridgeResult(receipt) === "verified" &&
    object(receipt.result)?.contentHash === projection.contentHash
  ) {
    return { ...projection, receiptId: receipt.receiptId, replay: true };
  }

  if (receipt.status === "received") {
    await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      { status: "received", stateVersion: receipt.stateVersion },
      {
        status: "processing",
        result: { bridgeStatus: "retry_scheduled" },
      },
    );
    receipt = (await getIntegrationReceipt("gbrain", externalEventId))!;
  }

  if (
    receipt.status === "processing" &&
    bridgeResult(receipt) === "processing" &&
    receipt.attemptToken &&
    leaseExpired(receipt)
  ) {
    await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      {
        status: "processing",
        bridgeStatus: "processing",
        attemptToken: receipt.attemptToken,
      },
      {
        status: "processing",
        result: { bridgeStatus: "retry_scheduled" },
        lastError: "GBRAIN_ATTEMPT_LEASE_EXPIRED",
      },
    );
    receipt = (await getIntegrationReceipt("gbrain", externalEventId))!;
  }

  if (
    receipt.status !== "processing" ||
    bridgeResult(receipt) !== "retry_scheduled"
  ) {
    throw new GbrainError(
      receipt.status === "failed"
        ? "GBRAIN_MANUAL_RECONCILIATION_REQUIRED"
        : "GBRAIN_OPERATION_IN_PROGRESS",
    );
  }

  const attempt = await beginIntegrationReceiptAttempt(
    receipt.receiptId,
    MAX_ATTEMPTS,
  );
  if (!attempt) throw new GbrainError("GBRAIN_OPERATION_IN_PROGRESS");

  try {
    const provider = await writeKnowledgeProjection(projection, options);
    const result = {
      bridgeStatus: provider.bridgeStatus,
      providerResult: provider.result,
      articleId: projection.articleId,
      version: projection.version,
      slug: projection.gbrainSlug,
      contentHash: projection.contentHash,
      sourceId,
      upstreamRevision: GBRAIN_UPSTREAM_REVISION,
      attempts: attempt.attempts,
    };
    const completed = await completeIntegrationReceiptIfProcessing(
      receipt.receiptId,
      attempt.attemptToken,
      result,
    );
    if (!completed) {
      const latest = await getIntegrationReceipt("gbrain", externalEventId);
      if (
        latest?.status === "completed" &&
        bridgeResult(latest) === "verified" &&
        object(latest.result)?.contentHash === projection.contentHash
      ) {
        return { ...projection, receiptId: receipt.receiptId, replay: true };
      }
      throw new GbrainError("GBRAIN_RECEIPT_STATE_CHANGED");
    }
    return { ...projection, receiptId: receipt.receiptId, replay: false };
  } catch (error) {
    const code =
      error instanceof GbrainError ? error.code : "GBRAIN_PROVIDER_ERROR";
    await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      {
        status: "processing",
        bridgeStatus: "processing",
        attemptToken: attempt.attemptToken,
      },
      attempt.attempts < MAX_ATTEMPTS
        ? {
            status: "processing",
            result: { bridgeStatus: "retry_scheduled" },
            lastError: code,
          }
        : {
            status: "failed",
            result: { bridgeStatus: "failed" },
            lastError: code,
          },
    );
    throw error instanceof GbrainError ? error : new GbrainError(code);
  }
}
