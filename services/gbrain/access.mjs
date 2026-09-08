import { createHmac, timingSafeEqual } from "node:crypto";

const uuid =
  "[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const id = new RegExp(`^${uuid}$`);
const source = new RegExp(`^hrmny-(company|personal-${uuid}|project-${uuid})$`);
const operations = new Set([
  "search",
  "get_page",
  "get_links",
  "get_backlinks",
]);

export function authorizedRequest(body, signature, secret, now = Date.now()) {
  if (
    typeof body !== "string" ||
    Buffer.byteLength(body) > 8192 ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    typeof secret !== "string" ||
    secret.length < 32
  )
    throw Error("ACCESS_DENIED");
  if (
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      createHmac("sha256", secret).update(body).digest(),
    )
  )
    throw Error("ACCESS_DENIED");
  const request = JSON.parse(body);
  if (
    request.version !== 1 ||
    request.audience !== "hrmny-brain" ||
    !id.test(request.requestId) ||
    !id.test(request.employeeId) ||
    !Number.isSafeInteger(request.expiresAt) ||
    request.expiresAt <= now ||
    // Issuers use a 15s lifetime; allow 5s of clock skew between hosts.
    request.expiresAt > now + 20000 ||
    !operations.has(request.operation)
  )
    throw Error("ACCESS_DENIED");
  if (
    !Array.isArray(request.sources) ||
    request.sources.length < 1 ||
    request.sources.length > 3 ||
    new Set(request.sources).size !== request.sources.length ||
    request.sources.some(
      (s) =>
        typeof s !== "string" ||
        !source.test(s) ||
        (s.startsWith("hrmny-personal-") &&
          s !== `hrmny-personal-${request.employeeId}`),
    )
  )
    throw Error("ACCESS_DENIED");
  const args = request.args;
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw Error("INVALID_ARGUMENTS");
  if (request.operation === "search") {
    if (
      typeof args.query !== "string" ||
      !args.query.trim() ||
      args.query.length > 500 ||
      args.limit !== 5 ||
      args.snippet_chars !== 1200 ||
      Object.keys(args).sort().join(",") !== "limit,query,snippet_chars"
    )
      throw Error("INVALID_ARGUMENTS");
  } else if (
    Object.keys(args).join(",") !== "slug" ||
    typeof args.slug !== "string" ||
    args.slug.length > 300 ||
    !/^[a-z0-9][a-z0-9/_-]*$/.test(args.slug)
  )
    throw Error("INVALID_ARGUMENTS");
  return request;
}

/** Return only source-proven pages and edges. Never expose the global source catalog or metadata. */
export function projectResult(operation, value, sources) {
  const allowed = new Set(sources);
  const rows = operation === "get_page" ? [value] : value;
  if (!Array.isArray(rows)) throw Error("PROVIDER_RESULT_INVALID");
  if (operation === "get_links" || operation === "get_backlinks") {
    return rows
      .filter(
        (r) =>
          r &&
          allowed.has(r.from_source_id) &&
          allowed.has(r.to_source_id) &&
          (!r.origin_source_id || allowed.has(r.origin_source_id)),
      )
      .slice(0, 50)
      .map((r) => ({
        from: r.from_slug,
        fromSource: r.from_source_id,
        to: r.to_slug,
        toSource: r.to_source_id,
        relation: String(r.link_type).slice(0, 100),
        context: String(r.context ?? "").slice(0, 1200),
      }));
  }
  return rows
    .filter((r) => r && allowed.has(r.source_id) && !r.deleted_at)
    .slice(0, 5)
    .map((r) => ({
      sourceId: r.source_id,
      slug: r.slug,
      title: String(r.title ?? "").slice(0, 300),
      content: String(
        operation === "search"
          ? (r.chunk_text ?? "")
          : (r.compiled_truth ?? ""),
      ).slice(0, operation === "search" ? 1200 : 12000),
      ...(operation === "search"
        ? {
            score: r.score,
            stale: r.stale === true,
            unverified: r.unverified === true,
          }
        : { contentHash: r.content_hash, updatedAt: r.updated_at }),
    }));
}
