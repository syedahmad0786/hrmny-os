const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Convert a Fetch response stream into a bounded body before handing it to
 * Next's route adapter. This avoids leaving the framework responsible for a
 * third-party stream while preserving status and headers exactly.
 */
export async function materializeResponse(response: Response) {
  const body =
    response.body && !BODYLESS_STATUSES.has(response.status)
      ? await response.arrayBuffer()
      : null;
  const headers = new Headers(response.headers);
  headers.delete("transfer-encoding");
  if (body) headers.set("content-length", String(body.byteLength));
  else headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
