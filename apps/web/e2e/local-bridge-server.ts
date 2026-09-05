import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/root";
import { createContext } from "@/server/trpc/trpc";
import { GET as readyRoute } from "@/app/api/ready/route";
import { SECURITY_HEADERS } from "../security-headers";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = Number(process.env.HRMNY_E2E_BRIDGE_PORT ?? "3500");
const NEXT_ORIGIN =
  process.env.HRMNY_E2E_NEXT_ORIGIN ?? "http://127.0.0.1:3100";
const STATIC_ROOT = fileURLToPath(new URL("../.next/static/", import.meta.url));
const HTML_ROOT = fileURLToPath(
  new URL("../.next/server/app/", import.meta.url),
);
const CLIENT_TEMPLATE_ID = "c1000000-0000-4000-8000-0000000000a4";
const DEAL_TEMPLATE_ID = "e0000000-0000-4000-8000-000000000001";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

function routeArtifact(url: URL, extension: "html" | "rsc") {
  const expectedNotFound = url.pathname === "/card/demo";
  const decoded = expectedNotFound
    ? "_not-found"
    : decodeURIComponent(url.pathname)
        .replace(/^\/+|\/+$/g, "")
        .replaceAll("/", "\\");
  const target = resolve(HTML_ROOT, `${decoded || "index"}.${extension}`);
  const relativePath = relative(HTML_ROOT, target);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return null;

  try {
    return readFileSync(target);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  const clientMatch = /^\/clients\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
  const dealMatch = /^\/crm\/deals\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
  const recordMatch = /^\/crm\/(companies|contacts)\/([0-9a-f-]{36})\/?$/i.exec(
    url.pathname,
  );
  const recordTemplateId =
    recordMatch?.[1] === "companies"
      ? "11000000-0000-4000-8000-000000000001"
      : "12000000-0000-4000-8000-000000000001";
  const templateRoute = clientMatch
    ? `clients\\${CLIENT_TEMPLATE_ID}`
    : dealMatch
      ? `crm\\deals\\${DEAL_TEMPLATE_ID}`
      : recordMatch
        ? `crm\\${recordMatch[1]}\\${recordTemplateId}`
        : null;
  const templateId = clientMatch
    ? CLIENT_TEMPLATE_ID
    : dealMatch
      ? DEAL_TEMPLATE_ID
      : recordMatch
        ? recordTemplateId
        : null;
  const actualId =
    clientMatch?.[1] ?? dealMatch?.[1] ?? recordMatch?.[2] ?? null;
  if (!templateRoute || !templateId || !actualId) return null;
  const template = resolve(HTML_ROOT, `${templateRoute}.${extension}`);
  try {
    const rewritten = readFileSync(template, "utf8").replaceAll(
      templateId,
      actualId,
    );
    return Buffer.from(rewritten);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function requestHeaders(req: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  headers.delete("host");
  headers.delete("content-length");
  return headers;
}

async function requestBody(req: IncomingMessage) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function writeFetchResponse(res: ServerResponse, response: Response) {
  const body =
    response.body && !BODYLESS_STATUSES.has(response.status)
      ? Buffer.from(await response.arrayBuffer())
      : undefined;

  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  res.shouldKeepAlive = false;
  res.setHeader("connection", "close");
  for (const [name, value] of response.headers.entries()) {
    if (
      name.toLowerCase() !== "set-cookie" &&
      !HOP_BY_HOP_HEADERS.has(name.toLowerCase())
    ) {
      res.setHeader(name, value);
    }
  }

  const getSetCookie = (
    response.headers as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie;
  const cookies = getSetCookie?.call(response.headers) ?? [];
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);

  if (body) res.setHeader("content-length", String(body.byteLength));
  else res.removeHeader("content-length");
  res.end(body);
}

async function serveNextStatic(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  const encodedPath = url.pathname.slice("/_next/static/".length);
  const target = resolve(STATIC_ROOT, decodeURIComponent(encodedPath));
  const relativePath = relative(STATIC_ROOT, target);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    await writeFetchResponse(
      res,
      Response.json(
        { status: "error", code: "INVALID_STATIC_PATH" },
        { status: 400 },
      ),
    );
    return;
  }

  try {
    // These immutable build artifacts are small. A synchronous read avoids the
    // Windows libuv file-pool stalls that this bridge exists to isolate.
    const body = readFileSync(target);
    res.statusCode = 200;
    res.shouldKeepAlive = false;
    res.setHeader("connection", "close");
    res.setHeader(
      "content-type",
      CONTENT_TYPES[extname(target).toLowerCase()] ??
        "application/octet-stream",
    );
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("content-length", String(body.byteLength));
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "STATIC_READ_FAILED";
    await writeFetchResponse(
      res,
      Response.json(
        { status: "error", code },
        { status: code === "ENOENT" ? 404 : 500 },
      ),
    );
  }
}

function serveBuiltHtml(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const acceptsHtml = req.headers.accept?.includes("text/html");
  const isDocument = req.headers["sec-fetch-dest"] === "document";
  if (!acceptsHtml && !isDocument) return false;

  const body = routeArtifact(url, "html");
  if (!body) return false;
  res.statusCode = url.pathname === "/card/demo" ? 404 : 200;
  res.shouldKeepAlive = false;
  res.setHeader("connection", "close");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", String(body.byteLength));
  for (const header of SECURITY_HEADERS) {
    res.setHeader(header.key, header.value);
  }
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

function serveBuiltRsc(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method !== "GET" || req.headers.rsc !== "1") return false;
  const body = routeArtifact(url, "rsc");
  if (!body) return false;
  res.statusCode = url.pathname === "/card/demo" ? 404 : 200;
  res.shouldKeepAlive = false;
  res.setHeader("connection", "close");
  res.setHeader("content-type", "text/x-component");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", String(body.byteLength));
  res.setHeader(
    "vary",
    "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-HMR-Refresh",
  );
  res.end(body);
  return true;
}

async function handleTrpc(req: IncomingMessage, res: ServerResponse, url: URL) {
  const body = await requestBody(req);
  const init: RequestInitWithDuplex = {
    method: req.method,
    headers: requestHeaders(req),
  };
  if (body) {
    init.body = body;
    init.duplex = "half";
  }

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request(url, init),
    router: appRouter,
    createContext,
  });
  await writeFetchResponse(res, response);
}

async function proxyToNext(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  const body = await requestBody(req);
  const headers = requestHeaders(req);
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.slice(0, -1));

  const init: RequestInitWithDuplex = {
    method: req.method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  };
  if (body) {
    init.body = body;
    init.duplex = "half";
  }

  const target = new URL(`${url.pathname}${url.search}`, NEXT_ORIGIN);
  const response = await fetch(target, init);
  await writeFetchResponse(res, response);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? `${LISTEN_HOST}:${LISTEN_PORT}`}`,
    );

    if (url.pathname === "/__e2e_bridge/ready") {
      await writeFetchResponse(
        res,
        Response.json({ status: "ok", nextOrigin: NEXT_ORIGIN }),
      );
      return;
    }

    if (url.pathname.startsWith("/_next/static/")) {
      await serveNextStatic(req, res, url);
      return;
    }

    if (req.headers["next-router-prefetch"] === "1") {
      await writeFetchResponse(res, new Response(null, { status: 204 }));
      return;
    }

    if (serveBuiltRsc(req, res, url)) return;

    if (url.pathname === "/api/ready" && req.method === "GET") {
      await writeFetchResponse(res, await readyRoute());
      return;
    }

    if (url.pathname.startsWith("/api/trpc/")) {
      await handleTrpc(req, res, url);
      return;
    }

    if (serveBuiltHtml(req, res, url)) return;

    await proxyToNext(req, res, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "REQUEST_BODY_TOO_LARGE" ? 413 : 502;
    await writeFetchResponse(
      res,
      Response.json({ status: "error", code: message }, { status }),
    );
  }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  process.stdout.write(
    `HRMNY E2E bridge listening on http://${LISTEN_HOST}:${LISTEN_PORT} (Next: ${NEXT_ORIGIN})\n`,
  );
});
